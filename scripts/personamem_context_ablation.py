#!/usr/bin/env python3
"""Prepare, run, and score a paired PersonaMem context-length ablation.

Preparation uses only question/options plus sealed retrieval artifacts. Gold answers are
loaded exclusively by the separate `score` command after all Answer calls finish.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import http.client
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
MEMORY_PREFIX_RE = re.compile(
    r"^\s*\[personamem[^\]]*\]\[session_[^\]]+\]\[D\d+:\d+\]\[text\]\s*"
    r"(?:User|Assistant|System):\s*",
    flags=re.IGNORECASE,
)
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


def history_answer_messages(
    question: str,
    options: list[str],
    history: list[dict[str, str]],
    supplemental_products: str | None = None,
) -> list[dict[str, str]]:
    option_text = "\n".join(f"{chr(65 + index)}. {option}" for index, option in enumerate(options))
    supplemental = (
        [{"role": "system", "content": supplemental_products}]
        if supplemental_products
        else []
    )
    return [
        *history,
        *supplemental,
        {"role": "user", "content": question + RECALL_SUFFIX},
        {"role": "system", "content": MCQ_PROMPT_TEMPLATE.format(options=option_text)},
    ]


def render_pimem_products(
    artifact: dict[str, Any],
    selected: list[dict[str, Any]],
    labels: dict[str, str],
) -> str:
    agent = artifact["agent"]
    selection = agent["selection"]
    candidates = {item["memoryId"]: item for item in agent["memory"].get("candidates", [])}
    query_order: list[str] = []
    seen_queries: set[str] = set()
    for step in agent.get("reasoning_trace", []):
        if step.get("toolName") != "search":
            continue
        for raw_query in step.get("args", {}).get("queries", []):
            query = str(raw_query).strip()
            if query and query not in seen_queries:
                seen_queries.add(query)
                query_order.append(query)
    for item in selected:
        for discovery in candidates.get(item["memoryId"], {}).get("discoveries", []):
            query = str(discovery.get("query") or "").strip()
            if query and query not in seen_queries:
                seen_queries.add(query)
                query_order.append(query)

    lines = [
        "<pimem_retrieval_products_v1>",
        "These are Pi-Mem Agent products derived only from the retrieved memories above. "
        "Treat generated summaries and support statements as navigation hints and verify them against raw memories.",
        f"selection_status: {selection.get('status', 'unknown')}",
        f"evidence_summary: {selection.get('evidence_summary', '')}",
        "counts: "
        f"candidates={agent['metrics'].get('candidateCount', 0)}, "
        f"read={agent['metrics'].get('evidenceCount', 0)}, "
        f"cited={agent['metrics'].get('citedCount', 0)}, "
        f"search_calls={agent['metrics'].get('searchCalls', 0)}",
        "planned_queries:",
    ]
    lines.extend(f"- {query}" for query in query_order)
    lines.append("agent_citation_support:")
    if selection.get("citations"):
        for citation in selection["citations"]:
            label = labels.get(citation["memoryId"], "not_in_top30")
            lines.append(f"- {label}: {citation.get('supports', '')}")
    else:
        lines.append("- none")
    lines.append("top30_inventory:")
    for item in selected:
        candidate = candidates.get(item["memoryId"], {})
        discoveries = candidate.get("discoveries", [])
        hit_text = "; ".join(
            f"rank={hit.get('rank')}, query={hit.get('query', '')}"
            for hit in discoveries
            if hit.get("rank") is not None or hit.get("query")
        ) or "context_expansion_or_no_search_hit"
        lines.append(
            f"- {labels[item['memoryId']]}: time={item.get('timestamp')}, "
            f"turn={item.get('turnIndex')}, role={item.get('role')}, "
            f"read={str(bool(candidate.get('read'))).lower()}, "
            f"cited={str(bool(candidate.get('cited'))).lower()}, hits=[{hit_text}]"
        )
    lines.append("</pimem_retrieval_products_v1>")
    return "\n".join(lines)


def prepare_upper_bound(args: argparse.Namespace) -> None:
    answer_inputs = [row for row in read_json(args.chunk_dir / "answer_input.json") if row.get("dataset") == DATASET]
    answer_inputs.sort(key=lambda row: row["qa_id"])
    marker = f":{DATASET}:"
    artifacts: dict[tuple[str, str], dict[str, Any]] = {}
    if args.mode in {"retrieved", "products"}:
        for path in sorted(args.artifact_dir.glob("*.json")):
            row = read_json(path)
            user_id = str(row.get("search", {}).get("user_id", ""))
            if marker in user_id:
                artifacts[(user_id.split(marker, 1)[1], normalize_question(row["search"]["query"]))] = row

    gold: dict[str, list[dict[str, str]]] = {}
    if args.mode == "gold":
        # This is the explicit oracle-only boundary. No retrieval request is made here.
        for sample in read_json(args.chunk_dir / "scriptmem_raw_for_eval" / f"{DATASET}.json"):
            for index, qa in enumerate(sample["qa"]):
                qa_id = f"{DATASET}:{sample['sample_id']}#q{index:04d}"
                seen: set[tuple[str, str]] = set()
                evidence: list[dict[str, str]] = []
                for item in qa.get("evidence", []):
                    role = str(item.get("role", "user")).lower()
                    content = str(item.get("content", "")).strip()
                    key = (role, " ".join(content.split()).casefold())
                    if not content or key in seen:
                        continue
                    seen.add(key)
                    evidence.append({"role": role, "content": content})
                gold[qa_id] = evidence

    rows: list[dict[str, Any]] = []
    for ai in answer_inputs:
        if args.mode in {"retrieved", "products"}:
            artifact = artifacts.get((ai["speaker_a_name"], normalize_question(ai["question"])))
            if artifact is None:
                raise RuntimeError(f"missing sealed retrieval artifact for {ai['qa_id']}")
            deduplicated: list[dict[str, Any]] = []
            seen_ids: set[str] = set()
            for item in artifact["agent"]["memory"].get("searched_memories", []):
                ident = str(item["memoryId"])
                if ident in seen_ids:
                    continue
                seen_ids.add(ident)
                deduplicated.append(item)
            selected = deduplicated[: args.top_k]
            selected.sort(key=lambda item: (
                str(item.get("timestamp") or ""),
                str(item.get("sessionId") or ""),
                int(item.get("turnIndex") or 0),
                str(item.get("memoryId") or ""),
            ))
            labels = {
                item["memoryId"]: f"P{index:02d}"
                for index, item in enumerate(selected, start=1)
            }
            history = [
                {
                    "role": str(item.get("role") or "user").lower(),
                    "content": (
                        f"[Pi-Mem memory {labels[item['memoryId']]}]\n"
                        if args.mode == "products"
                        else ""
                    ) + MEMORY_PREFIX_RE.sub("", str(item.get("content") or "")).strip(),
                }
                for item in selected
                if str(item.get("content") or "").strip()
            ]
            if args.mode == "products":
                supplemental_products = render_pimem_products(artifact, selected, labels)
                variant = "retrieved_top30_plus_pimem_products"
            else:
                supplemental_products = None
                variant = "retrieved_session_dedup_top30"
            oracle = False
        else:
            history = list(gold.get(ai["qa_id"], []))
            if not history:
                raise RuntimeError(f"missing gold memories for {ai['qa_id']}")
            variant = "gold_memories_oracle"
            oracle = True
            supplemental_products = None
        messages = history_answer_messages(
            ai["question"],
            [str(option) for option in ai.get("option", [])],
            history,
            supplemental_products,
        )
        request = {"model": args.model, "messages": messages, "temperature": 0}
        rows.append({
            "experiment_key": f"{ai['qa_id']}::{variant}",
            "qa_id": ai["qa_id"],
            "variant": variant,
            "oracle": oracle,
            "memory_count": len(history),
            "memory_chars": sum(len(item["content"]) for item in history) + len(supplemental_products or ""),
            "supplemental_product_chars": len(supplemental_products or ""),
            "request_sha256": sha256_text(canonical(request)),
            "request": request,
        })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical(row) + "\n")
    manifest = {
        "schema_version": "pimem-personamem-upper-bound-requests-v1",
        "dataset": DATASET,
        "mode": args.mode,
        "variant": rows[0]["variant"],
        "oracle": args.mode == "gold",
        "gold_access": args.mode == "gold",
        "question_count": len(rows),
        "model": args.model,
        "temperature": 0,
        "top_k": args.top_k if args.mode in {"retrieved", "products"} else None,
        "history_projection": "role-preserving original conversation messages; retrieved Top-K reordered chronologically",
        "supplemental_products": (
            ["selection status", "evidence summary", "candidate/read/cited/search counts", "planned queries", "citation support", "Top-30 inventory with read/cited flags and discovery ranks"]
            if args.mode == "products"
            else []
        ),
        "official_source_commit": "48dbfff3cb56838ebdc8fc514dd9953f9097ba0a",
        "official_personamem_prompt_sha256": "075d4aadf336f9af0ada074f14c7a70882f419c37d9c0b90ef7652a6477d8950",
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
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                http.client.RemoteDisconnected,
                TimeoutError,
                ConnectionError,
                OSError,
                RuntimeError,
                KeyError,
                ValueError,
            ) as exc:
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


def score_upper_bound(args: argparse.Namespace) -> None:
    requests = {row["experiment_key"]: row for row in read_jsonl(args.requests)}
    attempt_rows = read_jsonl(args.answers)
    successful = {row["experiment_key"]: row for row in attempt_rows if row.get("status") == "ok"}
    if set(successful) != set(requests):
        missing = sorted(set(requests) - set(successful))
        raise RuntimeError(f"upper-bound Answer run incomplete: {missing[:5]}")
    details = {
        row["qa_id"]: row
        for row in read_json(args.chunk_dir / "official_details.json")
        if row.get("dataset") == DATASET
    }
    raw_category: dict[str, str] = {}
    for sample in read_json(args.chunk_dir / "scriptmem_raw_for_eval" / f"{DATASET}.json"):
        for index, qa in enumerate(sample["qa"]):
            raw_category[f"{DATASET}:{sample['sample_id']}#q{index:04d}"] = qa.get("category", "unknown")

    rows: list[dict[str, Any]] = []
    for key, answer in successful.items():
        request = requests[key]
        gold_letter = details[answer["qa_id"]]["gold"][0]
        rows.append({
            **answer,
            "gold": gold_letter,
            "correct": answer["predicted_letter"] == gold_letter,
            "category": raw_category[answer["qa_id"]],
            "memory_count": request["memory_count"],
            "memory_chars": request["memory_chars"],
            "supplemental_product_chars": request.get("supplemental_product_chars", 0),
            "oracle": request.get("oracle", False),
        })
    variants: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        variants.setdefault(row["variant"], []).append(row)

    summary: dict[str, Any] = {
        "schema_version": "pimem-personamem-upper-bound-result-v1",
        "dataset": DATASET,
        "question_count": len({row["qa_id"] for row in rows}),
        "answer_count": len(rows),
        "official_leaderboard_accuracy": sum(item["score"] for item in details.values()) / len(details),
        "provider_reliability": {
            "attempt_records": len(attempt_rows),
            "recovered_error_records": sum(row.get("status") != "ok" for row in attempt_rows),
            "successful_experiment_keys": len(successful),
            "successful_records_requiring_retry": sum(int(row.get("attempts", 1)) > 1 for row in successful.values()),
            "recorded_provider_attempts": sum(int(row.get("attempts", 1)) for row in successful.values()),
        },
        "variants": {},
    }
    for variant, group in sorted(variants.items()):
        summary["variants"][variant] = {
            "oracle": all(row["oracle"] for row in group),
            "count": len(group),
            "correct": sum(row["correct"] for row in group),
            "accuracy": sum(row["correct"] for row in group) / len(group),
            "mean_memory_count": sum(row["memory_count"] for row in group) / len(group),
            "min_memory_count": min(row["memory_count"] for row in group),
            "max_memory_count": max(row["memory_count"] for row in group),
            "mean_memory_chars": sum(row["memory_chars"] for row in group) / len(group),
            "mean_supplemental_product_chars": sum(row.get("supplemental_product_chars", 0) for row in group) / len(group),
            "mean_duration_ms": sum(row["duration_ms"] for row in group) / len(group),
            "actual_models": sorted({row["actual_model"] for row in group}),
            "missing_final_letter": sum(not row["predicted_letter"] for row in group),
            "by_category": {
                category: {
                    "count": len(category_rows),
                    "correct": sum(row["correct"] for row in category_rows),
                    "accuracy": sum(row["correct"] for row in category_rows) / len(category_rows),
                    "mean_memory_count": sum(row["memory_count"] for row in category_rows) / len(category_rows),
                }
                for category in sorted({row["category"] for row in group})
                if (category_rows := [row for row in group if row["category"] == category])
            },
        }
    summary["paired_with_official"] = {}
    for variant, group in sorted(variants.items()):
        official_only = sum(bool(details[row["qa_id"]]["score"]) and not row["correct"] for row in group)
        variant_only = sum(not bool(details[row["qa_id"]]["score"]) and row["correct"] for row in group)
        summary["paired_with_official"][variant] = {
            "count": len(group),
            "official_correct_variant_wrong": official_only,
            "official_wrong_variant_correct": variant_only,
            "same_correctness": len(group) - official_only - variant_only,
            "mcnemar_exact_p": exact_mcnemar_p(official_only, variant_only),
        }

    pairs: dict[str, dict[str, dict[str, Any]]] = {}
    for row in rows:
        pairs.setdefault(row["qa_id"], {})[row["variant"]] = row
    summary["paired_variants"] = {}
    variant_names = sorted(variants)
    for left_index, left_name in enumerate(variant_names):
        for right_name in variant_names[left_index + 1:]:
            eligible_pair = [
                pair for pair in pairs.values()
                if left_name in pair and right_name in pair
            ]
            left_only_pair = sum(
                pair[left_name]["correct"] and not pair[right_name]["correct"]
                for pair in eligible_pair
            )
            right_only_pair = sum(
                not pair[left_name]["correct"] and pair[right_name]["correct"]
                for pair in eligible_pair
            )
            summary["paired_variants"][f"{left_name}__vs__{right_name}"] = {
                "count": len(eligible_pair),
                "left_correct_right_wrong": left_only_pair,
                "left_wrong_right_correct": right_only_pair,
                "same_prediction": sum(
                    pair[left_name]["predicted_letter"] == pair[right_name]["predicted_letter"]
                    for pair in eligible_pair
                ),
                "mcnemar_exact_p": exact_mcnemar_p(left_only_pair, right_only_pair),
            }

    left = "retrieved_session_dedup_top30"
    right = "gold_memories_oracle"
    eligible = [pair for pair in pairs.values() if left in pair and right in pair]
    if eligible:
        left_only = sum(pair[left]["correct"] and not pair[right]["correct"] for pair in eligible)
        right_only = sum(not pair[left]["correct"] and pair[right]["correct"] for pair in eligible)
        summary["paired"] = {
            "count": len(eligible),
            "retrieved_correct_gold_wrong": left_only,
            "retrieved_wrong_gold_correct": right_only,
            "same_prediction": sum(pair[left]["predicted_letter"] == pair[right]["predicted_letter"] for pair in eligible),
            "mcnemar_exact_p": exact_mcnemar_p(left_only, right_only),
        }
    args.output.write_text(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    with args.cases.open("w", encoding="utf-8") as handle:
        for row in sorted(rows, key=lambda item: item["experiment_key"]):
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

    upper_prep = sub.add_parser("prepare-upper-bound")
    upper_prep.add_argument("--artifact-dir", type=Path, required=True)
    upper_prep.add_argument("--chunk-dir", type=Path, required=True)
    upper_prep.add_argument("--output", type=Path, required=True)
    upper_prep.add_argument("--manifest", type=Path, required=True)
    upper_prep.add_argument("--mode", choices=["retrieved", "products", "gold"], required=True)
    upper_prep.add_argument("--top-k", type=int, default=30)
    upper_prep.add_argument("--model", default="gpt-4o-mini")
    upper_prep.set_defaults(func=prepare_upper_bound)

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

    upper_scorer = sub.add_parser("score-upper-bound")
    upper_scorer.add_argument("--requests", type=Path, required=True)
    upper_scorer.add_argument("--answers", type=Path, required=True)
    upper_scorer.add_argument("--chunk-dir", type=Path, required=True)
    upper_scorer.add_argument("--output", type=Path, required=True)
    upper_scorer.add_argument("--cases", type=Path, required=True)
    upper_scorer.set_defaults(func=score_upper_bound)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
