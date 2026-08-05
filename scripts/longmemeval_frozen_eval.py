#!/usr/bin/env python3
"""Frozen-retrieval re-answering and strict LongMemEval judging."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tqdm import tqdm

ANSWER_PROMPT = """You are asked to answer a question based on your memories of a conversation.

<instructions>
1. Use only the provided memories. Prefer the memory that answers the question most directly.
2. Your memories are episodic raw observations. Reason about what they imply. Do not refuse just because the answer is not stated verbatim.
3. The question may contain typos. Match it to the most relevant memory even if the wording differs.
4. When multiple answers are possible, list all supported answers, not just the first.
5. For counts or time intervals, enumerate carefully before answering.
6. Preserve specific names, titles, places, and labels from the memories. Use "Rob" not "a colleague", "Sweden" not "home country".
7. Convert relative times like "yesterday", "last month", and "last year" into dates, months, or years when the memory timestamp makes it clear. Keep week-based expressions relative.
8. If memories conflict, prefer the most recent supported memory.
9. For list questions, include all required items and no extras.
10. Keep the final answer minimal. Do not add explanation, background, or extra dates unless needed for correctness.
</instructions>

<memories>
Memories for user {{speaker_1_name}}:

{{speaker_1_memories}}

Memories for user {{speaker_2_name}}:

{{speaker_2_memories}}
</memories>

Question: {{question}}
Answer with the shortest correct phrase or sentence. No preamble, no fluff:"""

AGENT_TEXT_PRODUCTS_TEMPLATE = """Pi-Mem also produced the following natural-language synthesis from the retrieved memories. Use it as a reading aid, but verify it against the original conversation memories above.

Pi-Mem evidence summary:
{{evidence_summary}}

Pi-Mem supporting notes:
{{supports}}"""

SELECTION_V3_ANSWER_PROMPT = """You are asked to answer a question based on your memories of a conversation.

<instructions>
1. Use only the provided source memories. Prefer the memory that answers the question most directly.
2. The memories are episodic raw observations. Reason about what they imply; the answer need not appear verbatim.
3. The question may contain typos. Match it to the most relevant exact entity even if wording differs.
4. When multiple answers are possible, list all supported answers, not just the first.
5. For counts or time intervals, enumerate carefully before answering.
6. Preserve specific names, titles, places, and labels from the memories.
7. Convert relative times into dates, months, or years only when the memory timestamp and question require it. Keep week-based expressions relative.
8. If memories conflict, prefer the most recent supported memory only for current-state questions.
9. For list questions, include all required items and no extras.
10. Keep the final answer minimal. Do not add explanation, background, or extra dates unless needed for correctness.
</instructions>

<retrieval_package>
{{retrieval_package}}
</retrieval_package>

<memories role="user">
{{user_memories}}
</memories>

<memories role="assistant">
{{assistant_memories}}
</memories>

Question: {{question}}
Answer with the shortest correct phrase or sentence. No preamble, no fluff:"""

JUDGE_PROMPT = """Your task is to label an answer as \u2019CORRECT\u2019 or \u2019WRONG\u2019 given:
(1) a question,
(2) a gold (ground truth) answer,
(3) a generated answer.

Core principle \u2014 Inclusion + Non-contradiction
- Be GENEROUS: if the generated answer clearly includes the gold\u2019s key content (or a clear paraphrase of the same content) and does not contradict it, mark CORRECT \u2014 even if extra details are added.
- Mark WRONG only when the generated answer does not include the gold\u2019s content, changes it, or contradicts it.

TIME (strict granularity; relative form equivalence; no calendar math)
- Granularity must match exactly: HOUR\u2194HOUR, DAY\u2194DAY, MONTH\u2194MONTH, YEAR\u2194YEAR.
  Do not answer a gold at a different time unit \u2014 even if the numeric value overlaps. Do not answer a month-level gold with a specific day, nor a year with a specific month/day/hour, etc.
  (e.g., gold = "July 26, 2019" [DAY]; generated = "2019-07-26 08:09:17" [includes Second] \u2192 WRONG)
- Do NOT convert relative \u2194 absolute. If the gold uses a relative time expression, the generated answer must also use a relative form (or a clear paraphrase of that same form), not a computed date/range.
- Treat harmless modifiers in relative forms (e.g., "the/last/previous/just prior") as equivalent when both the anchor date and the time unit are the same.

- Lists of DISTINCT facts:
- If the gold answer lists multiple distinct facts (joined by "and", commas, or slashes), the generated answer must cover **all** of them.
- Extra non-contradictory items **generally count as WRONG**.
    - Example: gold = A, B, C ; gen = A, B, C \u2192 CORRECT
    - Example: gold = A, B, C ; gen = A, B, C, D \u2192 WRONG
- Exception: If a gold element is elaborated or split into finer details in the generated answer (e.g., C \u2192 C, C\u2032), it is still considered CORRECT.

Preference/Benefit Questions (e.g., "what X likes/values most")
- If gold lists multiple reasons/aspects, the generated answer only needs to include **any one** of them without contradiction to be CORRECT.

Now it's time for the real question:
Question: {question}
Gold answer: {gold_answer}
Generated answer: {generated_answer}

First, provide a short (one sentence) explanation of your reasoning, then finish with CORRECT or WRONG.
Do NOT include both CORRECT and WRONG in your response, or it will break the evaluation script.

Just return the label CORRECT or WRONG in a json format with the key as "label":

```json
{{
    "label": "CORRECT" or "WRONG"
}}
```"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare-frozen-input")
    prepare.add_argument("--results", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--include-selection-data", action="store_true")

    reanswer = subparsers.add_parser("reanswer")
    reanswer.add_argument("--input", type=Path, required=True)
    reanswer.add_argument("--output-dir", type=Path, required=True)
    reanswer.add_argument("--slots", type=int, default=32)
    reanswer.add_argument(
        "--mode",
        choices=(
            "exact-searched-memories",
            "raw-text-memories",
            "raw-text-plus-agent-products",
            "selection-aware-v3",
        ),
        default="exact-searched-memories",
    )

    attach_products = subparsers.add_parser("attach-text-products")
    attach_products.add_argument("--raw-input", type=Path, required=True)
    attach_products.add_argument("--results", type=Path, required=True)
    attach_products.add_argument("--output", type=Path, required=True)

    judge = subparsers.add_parser("judge")
    judge.add_argument("--input", type=Path, required=True)
    judge.add_argument("--output-dir", type=Path, required=True)
    judge.add_argument("--slots", type=int, default=32)
    judge.add_argument("--variant", required=True)
    return parser.parse_args()


def sha256_json(value: Any) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def safe_name(question_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", question_id).strip("-.")
    return f"{cleaned}-{hashlib.sha256(question_id.encode()).hexdigest()[:12]}.json"


def write_atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def memory_speakers(memories: list[dict[str, Any]]) -> tuple[str, str]:
    for memory in memories:
        session = (memory.get("metadata") or {}).get("session") or {}
        speaker_a = session.get("speakerA")
        speaker_b = session.get("speakerB")
        if isinstance(speaker_a, str) and isinstance(speaker_b, str):
            return speaker_a, speaker_b
    return "User", "Assistant"


def prepare_frozen_input(
    results_path: Path,
    output_path: Path,
    include_selection_data: bool = False,
) -> None:
    payload = read_json(results_path)
    records = payload.get("results")
    if not isinstance(records, list) or not records:
        raise ValueError("Expected a non-empty PiMem result set")

    prepared = []
    seen: set[str] = set()
    for record in records:
        question_id = record["question_id"]
        if question_id in seen:
            raise ValueError(f"Duplicate question ID: {question_id}")
        seen.add(question_id)
        result = record.get("result") or record.get("retrieval")
        if not isinstance(result, dict):
            raise ValueError(f"Missing PiMem retrieval result: {question_id}")
        memories = result["searchedMemories"]
        memory_ids = [memory["memoryId"] for memory in memories]
        if len(memory_ids) != len(set(memory_ids)):
            raise ValueError(f"Duplicate searched memory ID: {question_id}")
        speaker_1, speaker_2 = memory_speakers(memories)
        selection_data = {
            "selection_package": {
                "status": result.get("status"),
                "evidence_summary": result.get("evidenceSummary"),
                "count": result.get("count"),
                "inventory": result.get("inventory") or [],
                "citations": result.get("citations") or [],
            },
            "selected_memories": result.get("evidence") or [],
        }
        prepared.append(
            {
                "question_id": question_id,
                "scope_id": result["scopeId"],
                "question": result["question"],
                "question_date": result.get("questionDate"),
                "speaker_1_name": speaker_1,
                "speaker_2_name": speaker_2,
                "searched_memories": memories,
                "searched_memory_count": len(memories),
                "search_result_hash": sha256_json(
                    [
                        {
                            "memoryId": memory["memoryId"],
                            "contentHash": memory["contentHash"],
                        }
                        for memory in memories
                    ]
                ),
                **(
                    {
                        **selection_data,
                        "selection_data_hash": sha256_json(selection_data),
                    }
                    if include_selection_data
                    else {}
                ),
            }
        )

    write_atomic_json(
        output_path,
        {
            "schema_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "gold_fields_present": False,
            "original_answer_fields_present": False,
            **(
                {"selection_data_present": True}
                if include_selection_data
                else {}
            ),
            "question_count": len(prepared),
            "records": prepared,
        },
    )


def attach_text_products(
    raw_input_path: Path,
    results_path: Path,
    output_path: Path,
) -> None:
    raw_input = read_json(raw_input_path)
    if raw_input.get("gold_fields_present") is not False:
        raise ValueError("Raw input must explicitly exclude gold")
    records = raw_input.get("records")
    results = read_json(results_path).get("results")
    if not isinstance(records, list) or not isinstance(results, list):
        raise ValueError("Expected raw records and PiMem result records")
    retrieval_by_id: dict[str, dict[str, Any]] = {}
    for row in results:
        retrieval = row.get("result") or row.get("retrieval")
        question_id = row.get("question_id")
        if not isinstance(question_id, str) or not isinstance(retrieval, dict):
            raise ValueError("Invalid PiMem result record")
        if question_id in retrieval_by_id:
            raise ValueError(f"Duplicate PiMem result question ID: {question_id}")
        retrieval_by_id[question_id] = retrieval
    if {record["question_id"] for record in records} != set(retrieval_by_id):
        raise ValueError("Raw input and PiMem result question IDs differ")

    prepared = []
    for record in records:
        retrieval = retrieval_by_id[record["question_id"]]
        evidence_summary = retrieval.get("evidenceSummary")
        citations = retrieval.get("citations") or []
        supports = [
            citation.get("supports").strip()
            for citation in citations
            if isinstance(citation.get("supports"), str)
            and citation.get("supports").strip()
        ]
        if not isinstance(evidence_summary, str) or not evidence_summary.strip():
            raise ValueError(f"Missing Agent evidence summary: {record['question_id']}")
        products = {
            "evidence_summary": evidence_summary.strip(),
            "supports": supports,
        }
        prepared.append(
            {
                **record,
                "agent_text_products": products,
                "agent_text_products_hash": sha256_json(products),
            }
        )
    write_atomic_json(
        output_path,
        {
            **{key: value for key, value in raw_input.items() if key != "records"},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_from_raw_input": str(raw_input_path),
            "created_from_results": str(results_path),
            "raw_input_sha256": hashlib.sha256(raw_input_path.read_bytes()).hexdigest(),
            "results_sha256": hashlib.sha256(results_path.read_bytes()).hexdigest(),
            "agent_text_products_present": True,
            "agent_text_product_fields": ["evidenceSummary", "citation supports"],
            "excluded_agent_fields": [
                "status",
                "count",
                "inventory",
                "memory IDs",
                "queries",
                "ranks",
                "reasoning trace",
            ],
            "records": prepared,
        },
    )


def validate_reanswer_source(
    source: dict[str, Any],
    mode: str,
) -> list[dict[str, Any]]:
    if source.get("gold_fields_present") is not False:
        raise ValueError("Frozen answer input must explicitly exclude gold")
    records = source.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("Frozen answer input must contain a non-empty record set")
    selection_data_present = source.get("selection_data_present") is True
    products_present = source.get("agent_text_products_present") is True
    if mode == "selection-aware-v3" and not selection_data_present:
        raise ValueError("selection-aware-v3 mode requires prepared selection data")
    if mode == "raw-text-plus-agent-products" and not products_present:
        raise ValueError("raw-text-plus-agent-products mode requires text products")
    if mode in {"exact-searched-memories", "raw-text-memories"} and (
        selection_data_present or products_present
    ):
        raise ValueError("Raw-memory modes require input without selection data or Agent products")
    if source.get("question_count") != len(records):
        raise ValueError("Frozen answer input question count is inconsistent")
    return records


def render_memory(memory: dict[str, Any]) -> str:
    metadata = memory.get("metadata") or {}
    turn = metadata.get("turn") or {}
    speaker = turn.get("sourceSpeaker") or memory.get("role") or "unknown"
    timestamp = memory.get("timestamp") or "unknown-time"
    memory_id = memory["memoryId"]
    return f"- [{timestamp}] [{memory_id}] {speaker}: {memory['content']}"


def render_raw_text_memory(memory: dict[str, Any]) -> str:
    metadata = memory.get("metadata") or {}
    turn = metadata.get("turn") or {}
    speaker = turn.get("sourceSpeaker") or memory.get("role") or "unknown"
    timestamp = memory.get("timestamp") or "unknown-time"
    return f"- [{timestamp}] {speaker}: {memory['content']}"


def render_selection_v3_memory(memory: dict[str, Any]) -> str:
    timestamp = memory.get("timestamp")
    time_suffix = "" if timestamp is None else f" time={timestamp}"
    return f"[memoryId={memory['memoryId']}{time_suffix}]\n{memory['content']}"


def render_agent_text_products(record: dict[str, Any]) -> str:
    products = record.get("agent_text_products") or {}
    summary = products.get("evidence_summary")
    supports = products.get("supports") or []
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError(f"Missing Agent evidence summary: {record.get('question_id')}")
    if not isinstance(supports, list) or any(not isinstance(item, str) for item in supports):
        raise ValueError(f"Invalid Agent citation supports: {record.get('question_id')}")
    support_text = "\n".join(f"- {item}" for item in supports) or "- No supporting notes were produced."
    return (
        AGENT_TEXT_PRODUCTS_TEMPLATE
        .replace("{{evidence_summary}}", summary.strip())
        .replace("{{supports}}", support_text)
    )


def selection_v3_answer_prompt(record: dict[str, Any]) -> str:
    package = record.get("selection_package") or {}
    cited_ids = {
        citation.get("memoryId")
        for citation in package.get("citations") or []
    }
    selected = [
        memory for memory in record.get("selected_memories") or []
        if memory.get("memoryId") in cited_ids
    ]
    user_memories = "\n\n".join(
        render_selection_v3_memory(memory)
        for memory in selected
        if memory.get("role") == "user"
    )
    assistant_memories = "\n\n".join(
        render_selection_v3_memory(memory)
        for memory in selected
        if memory.get("role") != "user"
    )
    package_lines = [
        f"status={package.get('status')}",
        f"evidence_summary={package.get('evidence_summary')}",
    ]
    if package.get("count") is not None:
        package_lines.append(f"count={package['count']}")
    for item in package.get("inventory") or []:
        package_lines.append(
            f"inventory={item.get('item')} "
            f"[{', '.join(item.get('memoryIds') or [])}]"
        )
    for citation in package.get("citations") or []:
        package_lines.append(
            f"reference memoryId={citation.get('memoryId')}: "
            f"{citation.get('supports')}"
        )
    return (
        SELECTION_V3_ANSWER_PROMPT
        .replace("{{retrieval_package}}", "\n".join(package_lines))
        .replace("{{user_memories}}", user_memories or "(none selected)")
        .replace("{{assistant_memories}}", assistant_memories or "(none selected)")
        .replace("{{question}}", record["question"])
    )


def answer_prompt(record: dict[str, Any], mode: str) -> str:
    if mode == "selection-aware-v3":
        return selection_v3_answer_prompt(record)
    speaker_1 = record["speaker_1_name"]
    speaker_2 = record["speaker_2_name"]
    first: list[str] = []
    second: list[str] = []
    memories = record["searched_memories"]
    for memory in memories:
        metadata = memory.get("metadata") or {}
        session = metadata.get("session") or {}
        source_speaker = (metadata.get("turn") or {}).get("sourceSpeaker")
        role = memory.get("role")
        rendered = (
            render_raw_text_memory(memory)
            if mode in {"raw-text-memories", "raw-text-plus-agent-products"}
            else render_memory(memory)
        )
        if source_speaker == session.get("speakerA") or role == "user":
            first.append(rendered)
        else:
            second.append(rendered)
    prompt = (
        ANSWER_PROMPT.replace("{{speaker_1_name}}", speaker_1)
        .replace("{{speaker_1_memories}}", "\n".join(first) or "(none retrieved)")
        .replace("{{speaker_2_name}}", speaker_2)
        .replace("{{speaker_2_memories}}", "\n".join(second) or "(none retrieved)")
        .replace("{{question}}", record["question"])
    )
    if mode == "raw-text-plus-agent-products":
        products = render_agent_text_products(record)
        prompt = prompt.replace(
            "</memories>\n\nQuestion:",
            f"</memories>\n\n<agent_products>\n{products}\n</agent_products>\n\nQuestion:",
        )
    return prompt


def endpoint(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


def returned_model_matches(requested: str, returned: str) -> bool:
    return returned == requested or returned.startswith(f"{requested}-")


def blocking_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    max_tokens: int,
    timeout: int,
) -> dict[str, Any]:
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint(base_url),
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    response_model = payload.get("model")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Chat endpoint returned no answer content")
    if not isinstance(response_model, str) or not response_model.strip():
        raise ValueError("Chat endpoint returned no response model")
    return {
        "content": content.strip(),
        "model": response_model.strip(),
        "usage": payload.get("usage") or {},
    }


async def chat_with_retries(**kwargs: Any) -> dict[str, Any]:
    delay = 1
    while True:
        try:
            return await asyncio.to_thread(blocking_chat, **kwargs)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            if status in {401, 403} or isinstance(error, (ValueError, KeyError, TypeError)):
                raise
            kind = f"HTTP {status}" if status is not None else type(error).__name__
            print(f"chat retry after {kind}; waiting {delay}s", file=sys.stderr)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


def ensure_manifest(path: Path, config: dict[str, Any]) -> None:
    if path.exists():
        existing = read_json(path)
        if existing.get("config") != config:
            raise ValueError("Output directory has a different run configuration")
        return
    write_atomic_json(
        path,
        {
            "schema_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "config": config,
        },
    )


async def run_reanswer(args: argparse.Namespace) -> None:
    if args.slots <= 0:
        raise ValueError("--slots must be positive")
    api_key = os.environ.get("OPENAI_API_KEY", "")
    base_url = os.environ.get("OPENAI_API_BASE", "")
    model = os.environ.get("OPENAI_MODEL", "")
    expected_response_model = os.environ.get("PIMEM_EXPECTED_RESPONSE_MODEL", "")
    if not api_key or not base_url or not model or not expected_response_model:
        raise ValueError("answer.env variables and PIMEM_EXPECTED_RESPONSE_MODEL are required")

    source = read_json(args.input)
    records = validate_reanswer_source(source, args.mode)
    expected_count = len(records)

    output_dir: Path = args.output_dir
    records_dir = output_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output_dir, 0o700)
    os.chmod(records_dir, 0o700)
    prompt_template = (
        SELECTION_V3_ANSWER_PROMPT
        if args.mode == "selection-aware-v3"
        else (
            f"{ANSWER_PROMPT}\n{AGENT_TEXT_PRODUCTS_TEMPLATE}"
            if args.mode == "raw-text-plus-agent-products"
            else ANSWER_PROMPT
        )
    )
    run_modes = {
        "exact-searched-memories": "frozen-searched-memories-reanswer",
        "raw-text-memories": "raw-text-memories-reanswer",
        "raw-text-plus-agent-products": "raw-text-plus-agent-products-reanswer",
        "selection-aware-v3": "selection-aware-v3-reanswer",
    }
    config = {
        "mode": run_modes[args.mode],
        "question_count": expected_count,
        "input_hash": sha256_json(source),
        "prompt_hash": hashlib.sha256(prompt_template.encode()).hexdigest(),
        "model": model,
        "expected_response_model": expected_response_model,
        "slots": args.slots,
        "gold_visible_to_answer_stage": False,
        "original_answer_visible_to_answer_stage": False,
    }
    ensure_manifest(output_dir / "run-manifest.json", config)
    semaphore = asyncio.Semaphore(args.slots)

    async def process(record: dict[str, Any]) -> None:
        path = records_dir / safe_name(record["question_id"])
        if path.exists():
            existing = read_json(path)
            if existing.get("search_result_hash") != record["search_result_hash"]:
                raise ValueError(f"Frozen search hash changed: {record['question_id']}")
            return
        prompt = answer_prompt(record, args.mode)
        started = time.monotonic()
        async with semaphore:
            response = await chat_with_retries(
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=prompt,
                max_tokens=512,
                timeout=360,
            )
        if response["model"] != expected_response_model:
            raise ValueError(
                f"Answer response model {response['model']} does not match expected {expected_response_model}"
            )
        write_atomic_json(
            path,
            {
                "schema_version": 1,
                "question_id": record["question_id"],
                "question": record["question"],
                "response": response["content"],
                "model": response["model"],
                "usage": response["usage"],
                "latency_seconds": time.monotonic() - started,
                "searched_memory_count": record["searched_memory_count"],
                "search_result_hash": record["search_result_hash"],
                **(
                    {
                        "selection_data_hash": record.get("selection_data_hash")
                        or sha256_json(
                            {
                                "selection_package": record.get("selection_package") or {},
                                "selected_memories": record.get("selected_memories") or [],
                            }
                        ),
                        "mode": args.mode,
                    }
                    if args.mode == "selection-aware-v3"
                    else (
                        {
                            "agent_text_products_hash": record["agent_text_products_hash"],
                            "mode": args.mode,
                        }
                        if args.mode == "raw-text-plus-agent-products"
                        else {}
                    )
                ),
            },
        )

    tasks = [asyncio.create_task(process(record)) for record in records]
    task_errors: list[str] = []
    with tqdm(total=len(tasks), desc="Frozen re-answer", unit="q") as progress:
        for task in asyncio.as_completed(tasks):
            try:
                await task
            except Exception as error:
                task_errors.append(f"{type(error).__name__}: {error}")
                print(f"frozen answer record rejected: {task_errors[-1]}", file=sys.stderr)
            progress.update(1)
    if task_errors:
        print(f"frozen answer rejected records: {len(task_errors)}", file=sys.stderr)

    by_id = {}
    for path in records_dir.glob("*.json"):
        record = read_json(path)
        by_id[record["question_id"]] = record
    if len(by_id) != expected_count:
        raise ValueError(
            f"Expected {expected_count} frozen answers, found {len(by_id)}"
        )
    ordered = [by_id[record["question_id"]] for record in records]
    write_atomic_json(
        output_dir / "results.json",
        {
            "schema_version": 1,
            "result_count": expected_count,
            "results": ordered,
        },
    )
    predictions = "\n".join(
        json.dumps(
            {
                "question_id": record["question_id"],
                "response": record["response"],
                "decision": "answer",
                "citations": [],
            },
            ensure_ascii=False,
        )
        for record in ordered
    ) + "\n"
    predictions_path = output_dir / "predictions.jsonl"
    temporary = predictions_path.with_name(f".{predictions_path.name}.tmp-{os.getpid()}")
    temporary.write_text(predictions, encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, predictions_path)


def parse_label(content: str) -> str:
    candidates = re.findall(r'"label"\s*:\s*"(CORRECT|WRONG)"', content, re.I)
    if len(candidates) != 1:
        raise ValueError("Judge response does not contain exactly one JSON label")
    return candidates[0].upper()


async def run_judge(args: argparse.Namespace) -> None:
    if args.slots <= 0:
        raise ValueError("--slots must be positive")
    api_key = os.environ.get("JUDGER_API_KEY") or os.environ.get("PIMEM_JUDGER_API_KEY", "")
    base_url = os.environ.get("JUDGER_API_BASE") or os.environ.get("PIMEM_JUDGER_BASE_URL", "")
    model = os.environ.get("JUDGER_MODEL") or os.environ.get("PIMEM_JUDGER_MODEL", "")
    expected_response_model = os.environ.get("PIMEM_EXPECTED_JUDGER_RESPONSE_MODEL", "")
    if not api_key or not base_url or not model or not expected_response_model:
        raise ValueError("judger.env variables and PIMEM_EXPECTED_JUDGER_RESPONSE_MODEL are required")
    items = read_json(args.input)
    if not isinstance(items, list) or len(items) == 0:
        raise ValueError("Judge input must contain at least one record")
    question_count = len(items)

    output_dir: Path = args.output_dir
    records_dir = output_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output_dir, 0o700)
    os.chmod(records_dir, 0o700)
    config = {
        "mode": "strict-longmemeval-judge",
        "variant": args.variant,
        "question_count": question_count,
        "input_hash": sha256_json(items),
        "prompt_hash": hashlib.sha256(JUDGE_PROMPT.encode()).hexdigest(),
        "model": model,
        "expected_response_model": expected_response_model,
        "slots": args.slots,
    }
    ensure_manifest(output_dir / "run-manifest.json", config)
    semaphore = asyncio.Semaphore(args.slots)

    async def process(item: dict[str, Any]) -> None:
        path = records_dir / safe_name(item["question_id"])
        if path.exists():
            return
        prompt = JUDGE_PROMPT.format(
            question=item["question"],
            gold_answer=item["answer"],
            generated_answer=item.get("response", ""),
        )
        while True:
            started = time.monotonic()
            async with semaphore:
                response = await chat_with_retries(
                    base_url=base_url,
                    api_key=api_key,
                    model=model,
                    prompt=prompt,
                    max_tokens=256,
                    timeout=60,
                )
            if response["model"] != expected_response_model:
                raise ValueError(
                    f"Judge response model {response['model']} does not match expected {expected_response_model}"
                )
            try:
                label = parse_label(response["content"])
                break
            except ValueError:
                print("judge label parse retry; waiting 1s", file=sys.stderr)
                await asyncio.sleep(1)
        write_atomic_json(
            path,
            {
                "schema_version": 1,
                "variant": args.variant,
                "question_id": item["question_id"],
                "question_type": item["question_type"],
                "abstention": bool(item.get("abstention")),
                "question": item["question"],
                "gold_answer": item["answer"],
                "generated_answer": item.get("response", ""),
                "label": label,
                "score": 1 if label == "CORRECT" else 0,
                "judge_model": response["model"],
                "judge_response": response["content"],
                "usage": response["usage"],
                "latency_seconds": time.monotonic() - started,
            },
        )

    tasks = [asyncio.create_task(process(item)) for item in items]
    with tqdm(total=len(tasks), desc=f"Judge {args.variant}", unit="q") as progress:
        for task in asyncio.as_completed(tasks):
            await task
            progress.update(1)

    by_id = {}
    for path in records_dir.glob("*.json"):
        record = read_json(path)
        by_id[record["question_id"]] = record
    if len(by_id) != question_count:
        raise ValueError(
            f"Expected {question_count} judge records, found {len(by_id)}"
        )
    ordered = [by_id[item["question_id"]] for item in items]
    buckets: dict[str, list[int]] = defaultdict(list)
    for record in ordered:
        buckets[record["question_type"]].append(record["score"])
        buckets["abstention" if record["abstention"] else "answerable"].append(record["score"])
        buckets["overall"].append(record["score"])
    summary = {
        name: {
            "correct": sum(scores),
            "total": len(scores),
            "accuracy": sum(scores) / len(scores),
        }
        for name, scores in sorted(buckets.items())
    }
    write_atomic_json(
        output_dir / "results.json",
        {
            "schema_version": 1,
            "result_count": question_count,
            "results": ordered,
        },
    )
    write_atomic_json(
        output_dir / "summary.json",
        {
            "schema_version": 1,
            "variant": args.variant,
            "judge_model": model,
            "prompt_hash": config["prompt_hash"],
            "metrics": summary,
        },
    )


async def async_main(args: argparse.Namespace) -> None:
    if args.command == "reanswer":
        await run_reanswer(args)
    elif args.command == "judge":
        await run_judge(args)
    else:
        raise ValueError(f"Unknown async command: {args.command}")


def main() -> None:
    args = parse_args()
    if args.command == "prepare-frozen-input":
        prepare_frozen_input(
            args.results,
            args.output,
            args.include_selection_data,
        )
    elif args.command == "attach-text-products":
        attach_text_products(args.raw_input, args.results, args.output)
    else:
        asyncio.run(async_main(args))


if __name__ == "__main__":
    main()
