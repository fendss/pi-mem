#!/usr/bin/env python3
"""Prepare, run, and score a paired PersonaMem context-length ablation.

Preparation uses only question/options plus sealed retrieval artifacts. Gold answers are
loaded exclusively by the separate `score` command after all Answer calls finish.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DATASET = "personamem_v2_32k"
RECALL_SUFFIX = (
    " Please recall my related preferences from our conversation history "
    "to give personalized responses."
)
MCQ_PROMPT_TEMPLATE = """Please choose the best answer from the following options:

{options}

Think step by step about which answer best fits the user's query and conversation context.
Provide your reasoning first, then give your final answer as 'Final Answer: [Letter]'"""
CONTEXT_HEADER = "Retrieved conversation evidence:\n"
LETTER_PATTERNS = [
    re.compile(r"Final Answer:\s*\[?([A-Z])\]?", re.I),
    re.compile(r"final answer:\s*\[?([A-Z])\]?", re.I),
    re.compile(r"\\boxed\{([A-Z])\}", re.I),
    re.compile(r"\bAnswer:\s*([A-Z])", re.I),
]


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_question(value: str) -> str:
    return " ".join(value.split()).casefold()


def selected_memory_block(selected: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in selected:
        timestamp = str(item.get("created_at") or "").strip()
        text = str(item.get("text") or item.get("content") or "").strip()
        if not text:
            continue
        lines.append(f"- [{timestamp}] {text}" if timestamp else f"- {text}")
    return "\n".join(lines)


def answer_messages(question: str, options: list[str], selected: list[dict[str, Any]]) -> list[dict[str, str]]:
    option_text = "\n".join(f"{chr(65 + index)}. {option}" for index, option in enumerate(options))
    return [
        {"role": "system", "content": CONTEXT_HEADER + selected_memory_block(selected)},
        {"role": "user", "content": question + RECALL_SUFFIX},
        {"role": "system", "content": MCQ_PROMPT_TEMPLATE.format(options=option_text)},
    ]


def prepare(args: argparse.Namespace) -> None:
    answer_inputs = [row for row in read_json(args.chunk_dir / "answer_input.json") if row.get("dataset") == DATASET]
    answer_by_key = {(row["speaker_a_name"], normalize_question(row["question"])): row for row in answer_inputs}

    artifacts: dict[tuple[str, str], dict[str, Any]] = {}
    marker = f":{DATASET}:"
    for path in sorted(args.artifact_dir.glob("*.json")):
        row = read_json(path)
        user_id = str(row.get("search", {}).get("user_id", ""))
        if marker not in user_id:
            continue
        sample_id = user_id.split(marker, 1)[1]
        artifacts[(sample_id, normalize_question(row["search"]["query"]))] = row

    qa_ids = sorted(
        (row["qa_id"] for row in answer_inputs),
        key=lambda value: (sha256_text(value), value),
    )[: args.limit]
    selected_ids = set(qa_ids)
    rows: list[dict[str, Any]] = []
    for ai in answer_inputs:
        if ai["qa_id"] not in selected_ids:
            continue
        key = (ai["speaker_a_name"], normalize_question(ai["question"]))
        artifact = artifacts.get(key)
        if artifact is None:
            raise RuntimeError(f"missing sealed artifact for {ai['qa_id']}")
        current = list(ai["speaker_a_retrieval"].get("selected", []))
        package = [item for item in current if str(item.get("id", "")).startswith("pimem-package-")]
        candidates: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in artifact["agent"]["memory"].get("searched_memories", []):
            ident = str(item["memoryId"])
            if ident in seen:
                continue
            seen.add(ident)
            candidates.append({
                "id": ident,
                "text": item.get("content", ""),
                "created_at": item.get("timestamp") or "",
                "updated_at": "",
                "meta": {},
                "scores": {},
            })
        all_candidate_selected = package[:1] + candidates[: args.top_k]
        variants = {
            "cited_current": current,
            "all_candidates_top30": all_candidate_selected,
        }
        for variant, selected in variants.items():
            messages = answer_messages(ai["question"], [str(x) for x in ai.get("option", [])], selected)
            request = {
                "model": args.model,
                "messages": messages,
                "temperature": 0,
            }
            rows.append({
                "experiment_key": f"{ai['qa_id']}::{variant}",
                "qa_id": ai["qa_id"],
                "variant": variant,
                "memory_count": max(0, len(selected) - len(package[:1])),
                "memory_chars": sum(len(str(item.get("text") or item.get("content") or "")) for item in selected),
                "request_sha256": sha256_text(canonical(request)),
                "request": request,
            })

    rows.sort(key=lambda row: row["experiment_key"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical(row) + "\n")
    manifest = {
        "schema_version": "pimem-personamem-context-ablation-requests-v1",
        "dataset": DATASET,
        "selection": f"first {args.limit} qa_ids ordered by sha256(qa_id)",
        "gold_access": False,
        "model": args.model,
        "temperature": 0,
        "top_k": args.top_k,
        "variants": ["cited_current", "all_candidates_top30"],
        "request_count": len(rows),
        "question_count": len(rows) // 2,
        "official_source_commit": "48dbfff3cb56838ebdc8fc514dd9953f9097ba0a",
        "official_personamem_prompt_sha256": "075d4aadf336f9af0ada074f14c7a70882f419c37d9c0b90ef7652a6477d8950",
        "context_wrapper_sha256": sha256_text(CONTEXT_HEADER),
    }
    args.manifest.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))


def prepare_reranked(args: argparse.Namespace) -> None:
    answer_inputs = [row for row in read_json(args.chunk_dir / "answer_input.json") if row.get("dataset") == DATASET]
    selected_ids = set(sorted(
        (row["qa_id"] for row in answer_inputs),
        key=lambda value: (sha256_text(value), value),
    )[: args.limit])
    marker = f":{DATASET}:"
    artifacts: dict[tuple[str, str], dict[str, Any]] = {}
    for path in sorted(args.artifact_dir.glob("*.json")):
        row = read_json(path)
        user_id = str(row.get("search", {}).get("user_id", ""))
        if marker in user_id:
            artifacts[(user_id.split(marker, 1)[1], normalize_question(row["search"]["query"]))] = row

    expected = {
        "model": "Qwen/Qwen3-Reranker-4B",
        "revision": "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
        "manifest_sha256": "11159710006fbde455370d2bdd4b8d5d46620c14631d3f8c30781ee83ce4652f",
    }

    def one(ai: dict[str, Any]) -> dict[str, Any]:
        key = (ai["speaker_a_name"], normalize_question(ai["question"]))
        artifact = artifacts.get(key)
        if artifact is None:
            raise RuntimeError(f"missing sealed artifact for {ai['qa_id']}")
        current = list(ai["speaker_a_retrieval"].get("selected", []))
        package = [item for item in current if str(item.get("id", "")).startswith("pimem-package-")][:1]
        candidates: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in artifact["agent"]["memory"].get("searched_memories", []):
            ident = str(item["memoryId"])
            if ident in seen:
                continue
            seen.add(ident)
            candidates.append({
                "id": ident,
                "text": str(item.get("content", "")),
                "created_at": item.get("timestamp") or "",
                "updated_at": "",
                "meta": {},
                "scores": {},
            })
        reranker_query = ai["question"] + "\n\nOptions:\n" + "\n".join(
            f"{chr(65 + index)}. {option}" for index, option in enumerate(ai.get("option", []))
        )
        payload = {"query": reranker_query, "documents": [{"id": row["id"], "text": row["text"]} for row in candidates]}
        request = urllib.request.Request(
            args.reranker_url.rstrip("/") + "/v1/rerank",
            data=canonical(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            scored = json.loads(response.read())
        for field, value in expected.items():
            if scored.get(field) != value:
                raise RuntimeError(f"reranker {field} substitution: {scored.get(field)!r}")
        scores = {str(row["id"]): float(row["score"]) for row in scored.get("scores", [])}
        if set(scores) != {row["id"] for row in candidates}:
            raise RuntimeError(f"reranker score identity mismatch for {ai['qa_id']}")
        original_rank = {row["id"]: index for index, row in enumerate(candidates)}
        ranked = sorted(candidates, key=lambda row: (-scores[row["id"]], original_rank[row["id"]]))[: args.top_k]
        selected = package + ranked
        messages = answer_messages(ai["question"], [str(x) for x in ai.get("option", [])], selected)
        answer_request = {"model": args.model, "messages": messages, "temperature": 0}
        return {
            "experiment_key": f"{ai['qa_id']}::reranked_candidates_top30",
            "qa_id": ai["qa_id"],
            "variant": "reranked_candidates_top30",
            "memory_count": len(ranked),
            "memory_chars": sum(len(str(item.get("text") or "")) for item in selected),
            "request_sha256": sha256_text(canonical(answer_request)),
            "request": answer_request,
            "reranker": {
                **expected,
                "query_sha256": sha256_text(reranker_query),
                "scores": [{"id": row["id"], "score": scores[row["id"]]} for row in ranked],
            },
        }

    pending = [row for row in answer_inputs if row["qa_id"] in selected_ids]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        rows = list(pool.map(one, pending))
    rows.sort(key=lambda row: row["experiment_key"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical(row) + "\n")
    manifest = {
        "schema_version": "pimem-personamem-final-rerank-requests-v1",
        "gold_access": False,
        "question_count": len(rows),
        "variant": "reranked_candidates_top30",
        "top_k": args.top_k,
        "reranker": expected,
    }
    args.manifest.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, sort_keys=True))


def extract_letter(text: str) -> str:
    for pattern in LETTER_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).upper()
    return ""


def run(args: argparse.Namespace) -> None:
    api_key = os.environ.get(args.api_key_env, "")
    if not api_key:
        raise RuntimeError(f"missing API key environment variable: {args.api_key_env}")
    requests = read_jsonl(args.input)
    existing_rows = read_jsonl(args.output)
    existing = {row["experiment_key"] for row in existing_rows if row.get("status") == "ok"}
    pending = [row for row in requests if row["experiment_key"] not in existing]
    write_lock = threading.Lock()
    completed = len(existing)

    def one(row: dict[str, Any]) -> dict[str, Any]:
        last_error = ""
        started = time.monotonic()
        for attempt in range(1, args.attempts + 1):
            try:
                request = urllib.request.Request(
                    args.base_url.rstrip("/") + "/chat/completions",
                    data=canonical(row["request"]).encode("utf-8"),
                    headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=args.timeout) as response:
                    payload = json.loads(response.read())
                actual_model = payload.get("model")
                if actual_model != args.expected_response_model:
                    raise RuntimeError(
                        f"provider substituted model {actual_model!r}; expected {args.expected_response_model!r}"
                    )
                text = str(payload["choices"][0]["message"]["content"]).strip()
                if not text:
                    raise RuntimeError("empty answer")
                return {
                    "experiment_key": row["experiment_key"],
                    "qa_id": row["qa_id"],
                    "variant": row["variant"],
                    "status": "ok",
                    "attempts": attempt,
                    "request_sha256": row["request_sha256"],
                    "actual_model": actual_model,
                    "answer": text,
                    "predicted_letter": extract_letter(text),
                    "duration_ms": round((time.monotonic() - started) * 1000, 3),
                }
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError, KeyError, ValueError) as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < args.attempts:
                    time.sleep(min(8, 2 ** attempt))
        return {
            "experiment_key": row["experiment_key"],
            "qa_id": row["qa_id"],
            "variant": row["variant"],
            "status": "error",
            "attempts": args.attempts,
            "request_sha256": row["request_sha256"],
            "error": last_error,
            "duration_ms": round((time.monotonic() - started) * 1000, 3),
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("a", encoding="utf-8") as handle, concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(one, row) for row in pending]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            with write_lock:
                handle.write(canonical(result) + "\n")
                handle.flush()
                completed += 1
                print(f"completed={completed}/{len(requests)} status={result['status']}", flush=True)


def exact_mcnemar_p(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, k) for k in range(0, min(b, c) + 1)) / (2**n)
    return min(1.0, 2 * tail)


def score(args: argparse.Namespace) -> None:
    requests = {row["experiment_key"]: row for row in read_jsonl(args.requests)}
    answer_attempts = read_jsonl(args.answers)
    successful_answers = {
        row["experiment_key"]: row for row in answer_attempts if row.get("status") == "ok"
    }
    if set(successful_answers) != set(requests):
        missing = sorted(set(requests) - set(successful_answers))
        raise RuntimeError(f"Answer run is incomplete; missing successful keys: {missing[:5]}")
    answers = list(successful_answers.values())
    details = {
        row["qa_id"]: row
        for row in read_json(args.chunk_dir / "official_details.json")
        if row.get("dataset") == DATASET
    }
    official_outputs = {
        row["qa_id"]: row
        for row in read_json(args.chunk_dir / "answer_output.json")
        if row.get("dataset") == DATASET
    }
    raw_category: dict[str, str] = {}
    for sample in read_json(args.chunk_dir / "scriptmem_raw_for_eval" / f"{DATASET}.json"):
        for index, qa in enumerate(sample["qa"]):
            raw_category[f"{DATASET}:{sample['sample_id']}#q{index:04d}"] = qa.get("category", "unknown")

    scored: list[dict[str, Any]] = []
    for row in answers:
        gold = details[row["qa_id"]]["gold"][0]
        req = requests[row["experiment_key"]]
        scored.append({
            **row,
            "gold": gold,
            "correct": row["predicted_letter"] == gold,
            "category": raw_category[row["qa_id"]],
            "memory_count": req["memory_count"],
            "memory_chars": req["memory_chars"],
            "official_predicted": details[row["qa_id"]]["predicted"][0] if details[row["qa_id"]]["predicted"] else "",
        })

    by_variant: dict[str, list[dict[str, Any]]] = {}
    for row in scored:
        by_variant.setdefault(row["variant"], []).append(row)
    summary: dict[str, Any] = {
        "schema_version": "pimem-personamem-context-ablation-result-v1",
        "question_count": len({row["qa_id"] for row in scored}),
        "answer_count": len(scored),
        "provider_reliability": {
            "attempt_records": len(answer_attempts),
            "recovered_error_records": sum(row.get("status") != "ok" for row in answer_attempts),
            "successful_experiment_keys": len(successful_answers),
        },
        "variants": {},
    }
    for variant, rows in sorted(by_variant.items()):
        summary["variants"][variant] = {
            "count": len(rows),
            "correct": sum(row["correct"] for row in rows),
            "accuracy": sum(row["correct"] for row in rows) / len(rows),
            "mean_memory_count": sum(row["memory_count"] for row in rows) / len(rows),
            "mean_memory_chars": sum(row["memory_chars"] for row in rows) / len(rows),
            "mean_duration_ms": sum(row["duration_ms"] for row in rows) / len(rows),
            "actual_models": sorted({row["actual_model"] for row in rows}),
            "by_category": {
                category: {
                    "count": len(group),
                    "accuracy": sum(x["correct"] for x in group) / len(group),
                }
                for category in sorted({row["category"] for row in rows})
                if (group := [row for row in rows if row["category"] == category])
            },
        }
    pairs: dict[str, dict[str, dict[str, Any]]] = {}
    for row in scored:
        pairs.setdefault(row["qa_id"], {})[row["variant"]] = row
    summary["paired"] = {}
    comparisons = [
        ("cited_current", "all_candidates_top30"),
        ("cited_current", "reranked_candidates_top30"),
        ("all_candidates_top30", "reranked_candidates_top30"),
    ]
    for left, right in comparisons:
        eligible = [pair for pair in pairs.values() if left in pair and right in pair]
        if not eligible:
            continue
        left_only = sum(pair[left]["correct"] and not pair[right]["correct"] for pair in eligible)
        right_only = sum(not pair[left]["correct"] and pair[right]["correct"] for pair in eligible)
        summary["paired"][f"{left}__vs__{right}"] = {
            "count": len(eligible),
            "left_correct_right_wrong": left_only,
            "left_wrong_right_correct": right_only,
            "mcnemar_exact_p": exact_mcnemar_p(left_only, right_only),
            "same_prediction": sum(pair[left]["predicted_letter"] == pair[right]["predicted_letter"] for pair in eligible),
        }
    cited = by_variant["cited_current"]
    summary["baseline_reproduction"] = {
        "label_agreement_with_official": sum(row["predicted_letter"] == row["official_predicted"] for row in cited) / len(cited),
        "candidate_prompt_accuracy": sum(row["correct"] for row in cited) / len(cited),
        "official_subset_accuracy": sum(details[row["qa_id"]]["score"] for row in cited) / len(cited),
        "note": "Agreement is diagnostic because hosted temperature-0 calls are not guaranteed byte-stable.",
    }
    args.output.write_text(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    with args.cases.open("w", encoding="utf-8") as handle:
        for row in sorted(scored, key=lambda item: item["experiment_key"]):
            handle.write(canonical(row) + "\n")
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    prep = sub.add_parser("prepare")
    prep.add_argument("--artifact-dir", type=Path, required=True)
    prep.add_argument("--chunk-dir", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--manifest", type=Path, required=True)
    prep.add_argument("--limit", type=int, default=100)
    prep.add_argument("--top-k", type=int, default=30)
    prep.add_argument("--model", default="gpt-4o-mini")
    prep.set_defaults(func=prepare)

    rerank_prep = sub.add_parser("prepare-reranked")
    rerank_prep.add_argument("--artifact-dir", type=Path, required=True)
    rerank_prep.add_argument("--chunk-dir", type=Path, required=True)
    rerank_prep.add_argument("--output", type=Path, required=True)
    rerank_prep.add_argument("--manifest", type=Path, required=True)
    rerank_prep.add_argument("--reranker-url", required=True)
    rerank_prep.add_argument("--limit", type=int, default=100)
    rerank_prep.add_argument("--top-k", type=int, default=30)
    rerank_prep.add_argument("--model", default="gpt-4o-mini")
    rerank_prep.add_argument("--concurrency", type=int, default=16)
    rerank_prep.add_argument("--timeout", type=float, default=120.0)
    rerank_prep.set_defaults(func=prepare_reranked)

    runner = sub.add_parser("run")
    runner.add_argument("--input", type=Path, required=True)
    runner.add_argument("--output", type=Path, required=True)
    runner.add_argument("--base-url", required=True)
    runner.add_argument("--api-key-env", default="OPENAI_API_KEY")
    runner.add_argument("--expected-response-model", required=True)
    runner.add_argument("--concurrency", type=int, default=16)
    runner.add_argument("--attempts", type=int, default=3)
    runner.add_argument("--timeout", type=float, default=200.0)
    runner.set_defaults(func=run)

    scorer = sub.add_parser("score")
    scorer.add_argument("--requests", type=Path, required=True)
    scorer.add_argument("--answers", type=Path, required=True)
    scorer.add_argument("--chunk-dir", type=Path, required=True)
    scorer.add_argument("--output", type=Path, required=True)
    scorer.add_argument("--cases", type=Path, required=True)
    scorer.set_defaults(func=score)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
