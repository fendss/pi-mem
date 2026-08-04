#!/usr/bin/env python3
"""Bounded local HTTP service for the official Qwen3-Reranker yes/no scorer."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

MODEL_ID = os.environ.get("RERANKER_MODEL_ID", "Qwen/Qwen3-Reranker-4B")
MODEL_REVISION = os.environ.get(
    "RERANKER_MODEL_REVISION",
    "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
)
MODEL_PATH = os.environ.get("RERANKER_MODEL_PATH", "/models/Qwen3-Reranker-4B")
MODEL_MANIFEST_PATH = os.environ.get(
    "RERANKER_MODEL_MANIFEST_PATH",
    "/models/MODEL_MANIFEST.json",
)
INSTRUCTION = os.environ.get(
    "RERANKER_INSTRUCTION",
    "Given a memory retrieval query, rank immutable memory passages by whether "
    "they directly provide evidence that answers the query. Prefer an exact "
    "subject, relation, value, event, constraint, and time over merely topical text.",
)
MAX_DOCUMENTS = int(os.environ.get("RERANKER_MAX_DOCUMENTS", "100"))
MAX_LENGTH = int(os.environ.get("RERANKER_MAX_LENGTH", "2048"))
BATCH_SIZE = int(os.environ.get("RERANKER_BATCH_SIZE", "16"))
MAX_NUM_BATCHED_TOKENS = int(
    os.environ.get("RERANKER_MAX_NUM_BATCHED_TOKENS", "65536")
)
BACKEND = os.environ.get("RERANKER_BACKEND", "vllm").strip().lower()
GPU_MEMORY_UTILIZATION = float(
    os.environ.get("RERANKER_GPU_MEMORY_UTILIZATION", "0.25")
)
MAX_QUERY_CHARS = int(os.environ.get("RERANKER_MAX_QUERY_CHARS", "8192"))
MAX_DOCUMENT_CHARS = int(os.environ.get("RERANKER_MAX_DOCUMENT_CHARS", "32768"))
MAX_TOTAL_CHARS = int(os.environ.get("RERANKER_MAX_TOTAL_CHARS", "2097152"))

PREFIX = (
    '<|im_start|>system\nJudge whether the Document meets the requirements based '
    'on the Query and the Instruct provided. Note that the answer can only be '
    '"yes" or "no".<|im_end|>\n<|im_start|>user\n'
)
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def _positive_int(value: int, name: str) -> int:
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


if BACKEND not in {"transformers", "vllm"}:
    raise ValueError("RERANKER_BACKEND must be transformers or vllm")
if not 0 < GPU_MEMORY_UTILIZATION <= 0.9:
    raise ValueError("RERANKER_GPU_MEMORY_UTILIZATION must be in (0, 0.9]")

for _value, _name in (
    (MAX_DOCUMENTS, "RERANKER_MAX_DOCUMENTS"),
    (MAX_LENGTH, "RERANKER_MAX_LENGTH"),
    (BATCH_SIZE, "RERANKER_BATCH_SIZE"),
    (MAX_NUM_BATCHED_TOKENS, "RERANKER_MAX_NUM_BATCHED_TOKENS"),
    (MAX_QUERY_CHARS, "RERANKER_MAX_QUERY_CHARS"),
    (MAX_DOCUMENT_CHARS, "RERANKER_MAX_DOCUMENT_CHARS"),
    (MAX_TOTAL_CHARS, "RERANKER_MAX_TOTAL_CHARS"),
):
    _positive_int(_value, _name)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_manifest() -> str:
    manifest_path = Path(MODEL_MANIFEST_PATH).resolve(strict=True)
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != "pimem-reranker-model-manifest/v1":
        raise RuntimeError("invalid reranker model manifest schema")
    if manifest.get("model") != MODEL_ID or manifest.get("revision") != MODEL_REVISION:
        raise RuntimeError("reranker model manifest identity mismatch")
    root = Path(MODEL_PATH).resolve(strict=True)
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("reranker model manifest has no files")
    total = 0
    seen: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise RuntimeError("invalid reranker model manifest file entry")
        relative = item.get("path")
        if not isinstance(relative, str) or not relative or relative in seen:
            raise RuntimeError("invalid or duplicate reranker model manifest path")
        seen.add(relative)
        candidate = (root / relative).resolve(strict=True)
        if root not in candidate.parents or not candidate.is_file():
            raise RuntimeError("reranker model manifest path escapes the model root")
        expected_size = item.get("bytes")
        expected_hash = item.get("sha256")
        if candidate.stat().st_size != expected_size:
            raise RuntimeError(f"reranker model size mismatch: {relative}")
        if sha256_file(candidate) != expected_hash:
            raise RuntimeError(f"reranker model SHA-256 mismatch: {relative}")
        total += candidate.stat().st_size
    if total != manifest.get("total_bytes"):
        raise RuntimeError("reranker model manifest total size mismatch")
    return hashlib.sha256(manifest_bytes).hexdigest()


def format_instruction(instruction: str, query: str, document: str) -> str:
    return (
        f"<Instruct>: {instruction}\n"
        f"<Query>: {query}\n"
        f"<Document>: {document}"
    )


def validate_request(payload: Any) -> tuple[str, list[dict[str, str]], str]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be an object")
    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string")
    if len(query) > MAX_QUERY_CHARS:
        raise ValueError("query exceeds the character limit")
    instruction = payload.get("instruction", INSTRUCTION)
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("instruction must be a non-empty string")
    documents = payload.get("documents")
    if not isinstance(documents, list) or not documents:
        raise ValueError("documents must be a non-empty array")
    if len(documents) > MAX_DOCUMENTS:
        raise ValueError(f"documents exceeds the limit of {MAX_DOCUMENTS}")
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    total_chars = len(query) + len(instruction)
    for index, document in enumerate(documents):
        if not isinstance(document, dict):
            raise ValueError(f"documents[{index}] must be an object")
        identifier = document.get("id")
        text = document.get("text")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(f"documents[{index}].id must be a non-empty string")
        if identifier in seen:
            raise ValueError(f"duplicate document id: {identifier}")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"documents[{index}].text must be a non-empty string")
        if len(text) > MAX_DOCUMENT_CHARS:
            raise ValueError(f"documents[{index}].text exceeds the character limit")
        seen.add(identifier)
        total_chars += len(text)
        normalized.append({"id": identifier, "text": text})
    if total_chars > MAX_TOTAL_CHARS:
        raise ValueError("request exceeds the total character limit")
    return query, normalized, instruction


class Qwen3TransformersReranker:
    def __init__(self) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
            raise RuntimeError("reranker requires exactly one visible CUDA device")
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(
            MODEL_PATH,
            padding_side="left",
            local_files_only=True,
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_PATH,
            torch_dtype=torch.bfloat16,
            attn_implementation="flash_attention_2",
            local_files_only=True,
        ).cuda().eval()
        self.false_id = self.tokenizer.convert_tokens_to_ids("no")
        self.true_id = self.tokenizer.convert_tokens_to_ids("yes")
        if (
            not isinstance(self.false_id, int)
            or not isinstance(self.true_id, int)
            or self.false_id == self.true_id
        ):
            raise RuntimeError("model tokenizer has invalid yes/no token IDs")
        self.prefix_tokens = self.tokenizer.encode(PREFIX, add_special_tokens=False)
        self.suffix_tokens = self.tokenizer.encode(SUFFIX, add_special_tokens=False)
        if len(self.prefix_tokens) + len(self.suffix_tokens) >= MAX_LENGTH:
            raise RuntimeError("RERANKER_MAX_LENGTH is too small for the prompt contract")
        self.lock = threading.Lock()
        self.device_name = torch.cuda.get_device_name(0)
        self.backend = "transformers"

    def _inputs(self, pairs: list[str]) -> dict[str, Any]:
        available = MAX_LENGTH - len(self.prefix_tokens) - len(self.suffix_tokens)
        inputs = self.tokenizer(
            pairs,
            padding=False,
            truncation="longest_first",
            return_attention_mask=False,
            max_length=available,
        )
        for index, token_ids in enumerate(inputs["input_ids"]):
            inputs["input_ids"][index] = (
                self.prefix_tokens + token_ids + self.suffix_tokens
            )
        padded = self.tokenizer.pad(
            inputs,
            padding=True,
            pad_to_multiple_of=8,
            return_tensors="pt",
        )
        return {key: value.cuda(non_blocking=True) for key, value in padded.items()}

    def score(self, query: str, documents: list[dict[str, str]], instruction: str) -> list[float]:
        torch = self.torch
        scores: list[float] = []
        with self.lock, torch.inference_mode():
            for start in range(0, len(documents), BATCH_SIZE):
                chunk = documents[start : start + BATCH_SIZE]
                pairs = [
                    format_instruction(instruction, query, document["text"])
                    for document in chunk
                ]
                logits = self.model(**self._inputs(pairs)).logits[:, -1, :]
                yes = logits[:, self.true_id].float()
                no = logits[:, self.false_id].float()
                probabilities = torch.softmax(torch.stack([no, yes], dim=1), dim=1)[:, 1]
                scores.extend(float(value) for value in probabilities.cpu().tolist())
        if len(scores) != len(documents) or not all(math.isfinite(score) for score in scores):
            raise RuntimeError("model returned invalid reranker scores")
        return scores


class Qwen3VllmReranker:
    def __init__(self) -> None:
        from transformers import AutoTokenizer
        from vllm import AsyncEngineArgs, AsyncLLMEngine, SamplingParams

        # Do not initialize CUDA in this parent process before vLLM launches its
        # engine core; doing so makes a forked CUDA context invalid.
        self.tokenizer = AutoTokenizer.from_pretrained(
            MODEL_PATH,
            padding_side="left",
            local_files_only=True,
        )
        self.false_id = self.tokenizer("no", add_special_tokens=False).input_ids[0]
        self.true_id = self.tokenizer("yes", add_special_tokens=False).input_ids[0]
        if self.false_id == self.true_id:
            raise RuntimeError("model tokenizer has invalid yes/no token IDs")
        self.prefix_tokens = self.tokenizer.encode(PREFIX, add_special_tokens=False)
        self.suffix_tokens = self.tokenizer.encode(SUFFIX, add_special_tokens=False)
        if len(self.prefix_tokens) + len(self.suffix_tokens) >= MAX_LENGTH:
            raise RuntimeError("RERANKER_MAX_LENGTH is too small for the prompt contract")
        engine_args = AsyncEngineArgs(
            model=MODEL_PATH,
            tensor_parallel_size=1,
            max_model_len=MAX_LENGTH,
            max_num_seqs=MAX_DOCUMENTS,
            max_num_batched_tokens=MAX_NUM_BATCHED_TOKENS,
            enable_prefix_caching=True,
            gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            trust_remote_code=False,
            disable_log_stats=True,
        )
        self.model = AsyncLLMEngine.from_engine_args(engine_args)
        self.sampling = SamplingParams(
            temperature=0,
            max_tokens=1,
            logprobs=20,
            allowed_token_ids=[self.true_id, self.false_id],
        )
        self.device_name = "NVIDIA CUDA GPU"
        self.backend = "vllm"

    def _prompt(self, query: str, document: str, instruction: str) -> Any:
        from vllm.inputs.data import TokensPrompt

        body = self.tokenizer.encode(
            format_instruction(instruction, query, document),
            add_special_tokens=False,
        )
        available = MAX_LENGTH - len(self.prefix_tokens) - len(self.suffix_tokens) - 1
        tokens = self.prefix_tokens + body[:available] + self.suffix_tokens
        return TokensPrompt(prompt_token_ids=tokens)

    async def _score_one(self, prompt: Any) -> float:
        final = None
        async for output in self.model.generate(
            prompt,
            self.sampling,
            request_id=str(uuid.uuid4()),
        ):
            final = output
        if final is None:
            raise RuntimeError("vLLM returned no reranker output")
        logprobs = final.outputs[0].logprobs[-1]
        yes = logprobs.get(self.true_id)
        no = logprobs.get(self.false_id)
        yes_logprob = -10.0 if yes is None else float(yes.logprob)
        no_logprob = -10.0 if no is None else float(no.logprob)
        yes_probability = math.exp(yes_logprob)
        no_probability = math.exp(no_logprob)
        return yes_probability / (yes_probability + no_probability)

    async def score(
        self,
        query: str,
        documents: list[dict[str, str]],
        instruction: str,
    ) -> list[float]:
        scores = await asyncio.gather(*(
            self._score_one(self._prompt(query, document["text"], instruction))
            for document in documents
        ))
        if len(scores) != len(documents) or not all(math.isfinite(score) for score in scores):
            raise RuntimeError("model returned invalid reranker scores")
        return scores

    def shutdown(self) -> None:
        self.model.shutdown()


def create_app() -> Any:
    from fastapi import Body, FastAPI, HTTPException

    app = FastAPI(title="PiMem Qwen3 Reranker", docs_url=None, redoc_url=None)
    state: dict[str, Any] = {
        "engine": None,
        "started": time.monotonic(),
        "manifest_sha256": None,
    }

    @app.on_event("startup")
    async def startup() -> None:
        state["manifest_sha256"] = await asyncio.to_thread(verify_model_manifest)
        engine_type = (
            Qwen3VllmReranker if BACKEND == "vllm" else Qwen3TransformersReranker
        )
        state["engine"] = engine_type()

    @app.on_event("shutdown")
    async def shutdown() -> None:
        engine = state["engine"]
        if engine is not None and hasattr(engine, "shutdown"):
            engine.shutdown()

    @app.get("/health")
    async def health() -> dict[str, Any]:
        engine = state["engine"]
        return {
            "status": "ok" if engine is not None else "starting",
            "model": MODEL_ID,
            "revision": MODEL_REVISION,
            "manifest_sha256": state["manifest_sha256"],
            "device": None if engine is None else engine.device_name,
            "backend": None if engine is None else engine.backend,
            "max_documents": MAX_DOCUMENTS,
            "max_length": MAX_LENGTH,
        }

    @app.post("/v1/rerank")
    async def rerank(payload: Any = Body(...)) -> dict[str, Any]:
        engine = state["engine"]
        if engine is None:
            raise HTTPException(status_code=503, detail="model is not ready")
        try:
            query, documents, instruction = validate_request(payload)
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        started = time.monotonic()
        try:
            scores = (
                await engine.score(query, documents, instruction)
                if engine.backend == "vllm"
                else await asyncio.to_thread(
                    engine.score,
                    query,
                    documents,
                    instruction,
                )
            )
        except Exception as error:
            logging.exception("reranker inference failed")
            raise HTTPException(status_code=500, detail="reranker inference failed") from error
        ranked = sorted(
            (
                {"id": document["id"], "score": scores[index]}
                for index, document in enumerate(documents)
            ),
            key=lambda item: (-item["score"], item["id"]),
        )
        return {
            "model": MODEL_ID,
            "revision": MODEL_REVISION,
            "manifest_sha256": state["manifest_sha256"],
            "scores": ranked,
            "usage": {
                "documents": len(documents),
                "latency_ms": round((time.monotonic() - started) * 1000, 3),
            },
        }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("RERANKER_HOST", "0.0.0.0"),
        port=int(os.environ.get("RERANKER_PORT", "8090")),
        workers=1,
        log_level=os.environ.get("RERANKER_LOG_LEVEL", "info"),
    )
