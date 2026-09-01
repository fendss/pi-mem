#!/usr/bin/env python3
"""Paired oracle-evidence re-answer ablation for LongMemEval-S.

This is deliberately an analysis-only runner.  It uses benchmark gold-source
groups to construct an oracle upper bound and must never be used as a method
result.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml


SYSTEM_PROMPT = (
    "You are a helpful assistant that can read the context and memorize it "
    "for future retrieval."
)
TARGET_STAGE = "gold_committed_answer_wrong"
ARMS = ("b_current_evidence_no_summary", "c_gold_only_no_summary")
SUMMARY_RE = re.compile(
    r"\n?<retrieval_summary authority=\"navigation_only\">[\s\S]*?"
    r"</retrieval_summary>",
    re.MULTILINE,
)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} is not a JSON object")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def render_memory(row: sqlite3.Row) -> str:
    return "\n".join(
        [
            "<memory>",
            f"memory_id: {row['memory_id']}",
            f"session_id: {row['session_id']}",
            f"turn_index: {row['turn_index']}",
            f"role: {row['role']}",
            f"timestamp: {row['timestamp'] or 'unknown'}",
            "content:",
            row["content"],
            "</memory>",
        ]
    )


def remove_summary(prompt: str) -> str:
    updated, count = SUMMARY_RE.subn("", prompt, count=1)
    if count != 1 or "<retrieval_summary" in updated:
        raise ValueError("Expected exactly one retrieval_summary block")
    return updated


def status_from_prompt(prompt: str) -> str:
    match = re.match(r'<retrieval_package status="([^"]+)" ', prompt)
    if match is None:
        raise ValueError("Wrapped prompt does not begin with retrieval_package")
    return match.group(1)


def gold_prompt(query: str, status: str, memories: list[sqlite3.Row]) -> str:
    rendered = "\n".join(render_memory(memory) for memory in memories)
    return "\n".join(
        [
            f'<retrieval_package status="{status}" selected_sources="{len(memories)}">',
            "</retrieval_package>",
            '<memory_context authority="committed_exact_sources">',
            rendered,
            "</memory_context>",
            f"User: {query}",
        ]
    )


def chat_completion(
    *, base_url: str, api_key: str, model: str, prompt: str, thinking: str,
    max_tokens: int, timeout: float,
) -> tuple[str, str, int]:
    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "reasoning_effort": thinking,
            "max_completion_tokens": max_tokens,
        },
        ensure_ascii=False,
    ).encode()
    attempts = 0
    while True:
        attempts += 1
        request = Request(
            base_url.rstrip("/") + "/chat/completions",
            data=payload,
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode())
            content = body["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise RuntimeError("empty completion")
            response_model = body.get("model")
            return (
                content.strip(),
                response_model if isinstance(response_model, str) else model,
                attempts,
            )
        except HTTPError as error:
            if error.code not in {408, 409, 425, 429} and error.code < 500:
                raise RuntimeError(f"non-retryable answer HTTP {error.code}") from error
        except (URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError,
                TypeError, RuntimeError):
            pass
        if attempts >= 12:
            raise RuntimeError("answer completion exhausted 12 retryable attempts")
        time.sleep(min(2 ** min(attempts - 1, 5), 30))


def prepare(args: argparse.Namespace) -> None:
    artifact = read_json(args.artifact)
    diagnostic = read_json(args.diagnostic)
    manifest = read_json(args.manifest)
    baseline_judge = read_json(args.baseline_judge)
    config = yaml.safe_load(args.config.read_text())
    generation = config["credentials"]["generation"]
    base_url = generation.get("base_url", generation.get("baseUrl"))
    api_key = generation.get("api_key", generation.get("apiKey"))
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise ValueError("Generation credentials are incomplete")
    model = artifact["answer_model"]
    policy = artifact["answer_request_policy"]
    thinking = policy["thinking_level"]
    max_tokens = policy["max_tokens"]
    timeout = policy["timeout_seconds"]
    if (model, thinking, max_tokens) != ("gpt-5-mini", "medium", 4096):
        raise ValueError("Answer model/config does not match locked run")
    if artifact["answer_base_url"].rstrip("/") != base_url.rstrip("/"):
        raise ValueError("Config base URL differs from locked run")

    targets = [
        row for row in manifest["rows"] if row["rollup_stage"] == TARGET_STAGE
    ]
    if len(targets) != 13:
        raise ValueError(f"Expected 13 target rows, found {len(targets)}")
    target_ids = {row["benchmark_query_id"] for row in targets}
    artifact_rows = {row["benchmark_query_id"]: row for row in artifact["data"]}
    diagnostic_rows = {
        row["benchmark_query_id"]: row for row in diagnostic["rows"]
    }
    judge_rows = {
        row["benchmark_query_id"]: row for row in baseline_judge["data"]
    }
    if any(judge_rows[qid]["label"] for qid in target_ids):
        raise ValueError("Historical baseline target is not uniformly incorrect")

    wraps: dict[str, dict[str, Any]] = {}
    with args.wrap_audit.open() as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                wraps[row["wrap_id"]] = row

    connection = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    units: list[dict[str, Any]] = []
    for target in targets:
        qid = target["benchmark_query_id"]
        source = artifact_rows[qid]
        diagnostic_row = diagnostic_rows[qid]
        if diagnostic_row["stage"] != TARGET_STAGE:
            raise ValueError(f"Diagnostic stage mismatch for {qid}")
        wrap = wraps[target["wrap_id"]]
        if wrap["question"] != source["query"]:
            raise ValueError(f"Wrap/artifact query mismatch for {qid}")
        if not wrap["prompt"].endswith(f"User: {source['query']}"):
            raise ValueError(f"Wrapped prompt task suffix changed for {qid}")
        groups = diagnostic_row["gold_source_groups"]
        if any(len(group) != 1 for group in groups):
            raise ValueError(f"Gold group is not a singleton for {qid}")
        gold_ids = [group[0] for group in groups]
        gold_memories: list[sqlite3.Row] = []
        for memory_id in gold_ids:
            memory = connection.execute(
                "SELECT memory_id, scope_id, session_id, turn_index, role, "
                "content, timestamp, content_hash, metadata_json FROM memories "
                "WHERE memory_id = ?",
                (memory_id,),
            ).fetchone()
            if memory is None:
                raise ValueError(f"Missing gold parent memory {memory_id}")
            gold_memories.append(memory)
        b_prompt = remove_summary(wrap["prompt"])
        c_prompt = gold_prompt(
            source["query"], status_from_prompt(wrap["prompt"]), gold_memories
        )
        units.extend(
            [
                {
                    "arm": ARMS[0], "benchmark_query_id": qid,
                    "prompt": b_prompt, "selected_memory_ids": wrap["selectedMemoryIds"],
                    "gold_memory_ids": gold_ids,
                },
                {
                    "arm": ARMS[1], "benchmark_query_id": qid,
                    "prompt": c_prompt, "selected_memory_ids": gold_ids,
                    "gold_memory_ids": gold_ids,
                },
            ]
        )
    connection.close()

    results_path = args.output / "answer-results.json"
    if results_path.exists():
        results = read_json(results_path)
    else:
        results = {
            "schema_version": 1,
            "experiment": "oracle-evidence-reanswer-bc",
            "warning": "Oracle upper bound: benchmark gold-source groups contaminate arm C.",
            "source_artifact": str(args.artifact),
            "pipeline_diagnostic": str(args.diagnostic),
            "target_stage": TARGET_STAGE,
            "target_count": 13,
            "arms": {
                ARMS[0]: "Original committed exact sources; retrieval_summary removed.",
                ARMS[1]: "One exact parent source per gold-source group; retrieval_summary removed.",
            },
            "answer": {
                "model": model, "thinking_level": thinking,
                "max_completion_tokens": max_tokens,
                "system_prompt": SYSTEM_PROMPT,
                "system_prompt_sha256": sha256_text(SYSTEM_PROMPT),
                "base_url": base_url,
                "concurrency": args.concurrency,
            },
            "rows": [],
        }
        write_json(results_path, results)
    completed = {
        (row["arm"], row["benchmark_query_id"]) for row in results["rows"]
    }
    lock = threading.Lock()

    def execute(unit: dict[str, Any]) -> dict[str, Any]:
        started = time.monotonic()
        answer, response_model, attempts = chat_completion(
            base_url=base_url, api_key=api_key, model=model,
            prompt=unit["prompt"], thinking=thinking, max_tokens=max_tokens,
            timeout=timeout,
        )
        return {
            **unit,
            "prompt_sha256": sha256_text(unit["prompt"]),
            "output": answer,
            "response_model": response_model,
            "attempts": attempts,
            "elapsed_seconds": time.monotonic() - started,
        }

    pending = [unit for unit in units if (unit["arm"], unit["benchmark_query_id"]) not in completed]
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(execute, unit) for unit in pending]
        for future in as_completed(futures):
            row = future.result()
            with lock:
                results["rows"].append(row)
                write_json(results_path, results)
            print(json.dumps({"completed": len(results["rows"]), "total": len(units)}), flush=True)
    if len(results["rows"]) != 26:
        raise ValueError("Answer result set is incomplete")

    result_by_arm = {
        arm: {row["benchmark_query_id"]: row for row in results["rows"] if row["arm"] == arm}
        for arm in ARMS
    }
    for arm in ARMS:
        source = copy.deepcopy(artifact)
        source["oracle_evidence_ablation"] = {
            "arm": arm,
            "target_stage": TARGET_STAGE,
            "target_count": 13,
            "warning": "Oracle research artifact; not a method score.",
        }
        for row in source["data"]:
            qid = row["benchmark_query_id"]
            if qid in target_ids:
                oracle = result_by_arm[arm][qid]
                row["historical_output"] = row["output"]
                row["output"] = oracle["output"]
                row["oracle_evidence_arm"] = arm
        source_path = args.output / f"source-{arm}" / "longmemeval-s-static.json"
        write_json(source_path, source)
        seeded = copy.deepcopy(baseline_judge)
        seeded["data"] = [
            row for row in baseline_judge["data"]
            if row["benchmark_query_id"] not in target_ids
        ]
        seeded["summary"] = {"note": "Seeded non-target historical rows only"}
        judge_path = args.output / f"judge-{arm}" / "longmemeval-s-static.json"
        write_json(judge_path, seeded)

    write_json(
        args.output / "run-manifest.json",
        {
            "status": "answers_complete_judge_pending",
            "target_ids": sorted(target_ids),
            "answer_results": str(results_path),
            "official_evaluator": str(args.official_evaluator),
            "config": str(args.config),
        },
    )


def finalize(args: argparse.Namespace) -> None:
    manifest = read_json(args.output / "run-manifest.json")
    target_ids = set(manifest["target_ids"])
    answers = read_json(args.output / "answer-results.json")
    source_rows = {
        row["benchmark_query_id"]: row for row in read_json(args.artifact)["data"]
    }
    answer_rows = {
        (row["arm"], row["benchmark_query_id"]): row for row in answers["rows"]
    }
    paired: list[dict[str, Any]] = []
    labels: dict[str, dict[str, bool]] = {}
    for arm in ARMS:
        judged = read_json(args.output / f"judge-{arm}" / "longmemeval-s-static.json")
        arm_labels = {
            row["benchmark_query_id"]: bool(row["label"])
            for row in judged["data"] if row["benchmark_query_id"] in target_ids
        }
        if set(arm_labels) != target_ids:
            raise ValueError(f"Official judge incomplete for {arm}")
        labels[arm] = arm_labels
    for qid in sorted(target_ids):
        source = source_rows[qid]
        paired.append(
            {
                "benchmark_query_id": qid,
                "question_id": source["question_id"],
                "question_type": source["question_type"],
                "query": source["query"],
                "gold_answer": source["answer"],
                "historical_output": source["output"],
                **{
                    arm: {
                        "output": answer_rows[(arm, qid)]["output"],
                        "label": labels[arm][qid],
                        "selected_memory_ids": answer_rows[(arm, qid)]["selected_memory_ids"],
                    }
                    for arm in ARMS
                },
            }
        )
    paired_outcomes = {
        "both_correct": sum(
            row[ARMS[0]]["label"] and row[ARMS[1]]["label"] for row in paired
        ),
        "b_only": sum(
            row[ARMS[0]]["label"] and not row[ARMS[1]]["label"] for row in paired
        ),
        "c_only": sum(
            not row[ARMS[0]]["label"] and row[ARMS[1]]["label"] for row in paired
        ),
        "neither": sum(
            not row[ARMS[0]]["label"] and not row[ARMS[1]]["label"] for row in paired
        ),
    }
    evidence_package = {}
    for arm in ARMS:
        arm_rows = [row for row in answers["rows"] if row["arm"] == arm]
        source_counts = [len(row["selected_memory_ids"]) for row in arm_rows]
        prompt_chars = [len(row["prompt"]) for row in arm_rows]
        evidence_package[arm] = {
            "selected_sources_total": sum(source_counts),
            "selected_sources_mean": sum(source_counts) / len(source_counts),
            "prompt_characters_total": sum(prompt_chars),
            "prompt_characters_mean": sum(prompt_chars) / len(prompt_chars),
        }
    summary = {
        "schema_version": 1,
        "experiment": "oracle-evidence-reanswer-bc",
        "warning": "Arm C uses benchmark gold sources and is only an oracle upper bound.",
        "historical_baseline": {"correct": 0, "total": 13},
        "arms": {
            arm: {
                "correct": sum(labels[arm].values()),
                "total": 13,
                "accuracy": sum(labels[arm].values()) / 13,
            }
            for arm in ARMS
        },
        "paired_outcomes": paired_outcomes,
        "evidence_package": evidence_package,
        "paired": paired,
    }
    write_json(args.output / "summary.json", summary)
    manifest["status"] = "complete"
    manifest["summary"] = str(args.output / "summary.json")
    write_json(args.output / "run-manifest.json", manifest)
    print(json.dumps(summary["arms"], ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("prepare", "finalize"), default="prepare")
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--diagnostic", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--wrap-audit", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--baseline-judge", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--official-evaluator", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 32:
        raise ValueError("concurrency must be 1..32")
    if args.mode == "prepare":
        prepare(args)
    else:
        finalize(args)


if __name__ == "__main__":
    main()
