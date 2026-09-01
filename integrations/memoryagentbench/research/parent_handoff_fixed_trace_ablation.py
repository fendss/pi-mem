#!/usr/bin/env python3
"""Fixed-trace A/B for excerpt-only versus budgeted full-parent handoff.

The experiment never reruns retrieval.  Arm A byte-reconstructs the frozen
answer prompt.  Arm B replaces every selected exact excerpt with its immutable
full parent only when the resulting prompt fits one global byte budget;
otherwise the prompt remains byte-identical to A.  Gold answers are used only
after generation for the benchmark's registered deterministic metric.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sqlite3
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml


TASKS = ("fact-mh-6k", "fact-sh-6k", "ruler-qa1")
ARMS = ("a_current_excerpt", "b_full_parent_if_budgeted")
SYSTEM_PROMPT = (
    "You are a helpful assistant that can read the context and memorize it "
    "for future retrieval."
)
EXPERIMENT = "fixed-trace-budgeted-full-parent-handoff-v1"
SCHEDULE_SEED = EXPERIMENT + "|paired-order|sha256"


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(
        f".{path.name}.tmp-{os.getpid()}-{threading.get_ident()}"
    )
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    fsync_directory(path.parent)


def render_prompt(question: str, sources: Iterable[dict[str, Any]]) -> str:
    memories = list(sources)
    lines = [
        f'<retrieval_package selected_sources="{len(memories)}">',
        "</retrieval_package>",
        '<memory_context authority="read_exact_sources">',
    ]
    if not memories:
        lines.append("None")
    for source in memories:
        lines.extend(
            [
                "<memory>",
                f"memory_id: {source['memory_id']}",
                f"session_id: {source['session_id']}",
                f"turn_index: {source['turn_index']}",
                f"role: {source['role']}",
                f"timestamp: {source['timestamp'] or 'unknown'}",
                "content:",
                source["content"],
                "</memory>",
            ]
        )
    lines.extend(["</memory_context>", f"User: {question}"])
    return "\n".join(lines)


def artifact_path(source_root: Path, run_label: str, task: str) -> Path:
    return source_root / "runs" / run_label / f"{task}-static.json"


def load_final_wraps(
    wrap_path: Path, run_rows: dict[tuple[str, str], dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    matches: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with wrap_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            wrap = json.loads(line)
            row = run_rows.get((wrap["userId"], wrap["question"]))
            if row is not None:
                matches[row["benchmark_query_id"]].append(wrap)
    return {
        query_id: max(rows, key=lambda row: row.get("created_at", ""))
        for query_id, rows in matches.items()
    }


def prepare(args: argparse.Namespace) -> None:
    source_root = args.source_root.resolve()
    output = args.output.resolve()
    paths = {
        "wrap_audit": source_root / "runtime/memory-service/wrap-audits.jsonl",
        "database": source_root / "runtime/memory-service/memory.sqlite",
        **{
            f"run_{task}": artifact_path(source_root, args.run_label, task)
            for task in TASKS
        },
    }
    missing = [name for name, path in paths.items() if not path.is_file()]
    if missing:
        raise ValueError(f"Missing fixed-trace inputs: {missing}")
    artifacts = {task: read_json(paths[f"run_{task}"]) for task in TASKS}
    for task, artifact in artifacts.items():
        if (
            artifact.get("task") != task
            or artifact.get("completed_queries") != 100
            or len(artifact.get("data", [])) != 100
            or artifact.get("answer_model") != "gpt-5-mini"
            or artifact.get("answer_request_policy", {}).get("thinking_level")
            != "medium"
            or artifact.get("answer_request_policy", {}).get("max_tokens") != 4096
            or artifact.get("answer_system_prompt_sha256")
            != sha256_text(SYSTEM_PROMPT)
        ):
            raise ValueError(f"Frozen answer contract changed for {task}")

    run_rows: dict[tuple[str, str], dict[str, Any]] = {}
    row_by_id: dict[str, tuple[str, dict[str, Any]]] = {}
    for task, artifact in artifacts.items():
        users = artifact["context_ingestion_users"]
        for row in artifact["data"]:
            key = (users[str(row["context_id"])], row["query"])
            if key in run_rows or row["benchmark_query_id"] in row_by_id:
                raise ValueError("Run join identity is not unique")
            run_rows[key] = row
            row_by_id[row["benchmark_query_id"]] = (task, row)
    wraps = load_final_wraps(paths["wrap_audit"], run_rows)
    if set(wraps) != set(row_by_id):
        missing_wraps = sorted(set(row_by_id) - set(wraps))
        raise ValueError(f"Fixed retrieval wrap missing for {len(missing_wraps)} rows")

    connection = sqlite3.connect(
        f"file:{paths['database']}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise ValueError("Immutable source database failed quick_check")

    rows: list[dict[str, Any]] = []
    expanded_by_task: dict[str, int] = defaultdict(int)
    try:
        for query_id in sorted(row_by_id):
            task, run_row = row_by_id[query_id]
            wrap = wraps[query_id]
            retrieval = wrap["retrieval"]
            evidence = retrieval.get("evidence") or retrieval["audit"].get(
                "evidence", []
            )
            selected_ids = wrap["selectedMemoryIds"]
            if [item["memoryId"] for item in evidence] != selected_ids:
                raise ValueError(f"Evidence order differs from selected IDs: {query_id}")
            excerpt_sources: list[dict[str, Any]] = []
            parent_sources: list[dict[str, Any]] = []
            for item in evidence:
                source = connection.execute(
                    "SELECT memory_id, scope_id, session_id, turn_index, role, "
                    "content, timestamp, content_hash FROM memories WHERE memory_id=?",
                    (item["memoryId"],),
                ).fetchone()
                if source is None or sha256_text(source["content"]) != source["content_hash"]:
                    raise ValueError(f"Immutable parent mismatch: {item['memoryId']}")
                expected = {
                    "scopeId": source["scope_id"],
                    "sessionId": source["session_id"],
                    "turnIndex": source["turn_index"],
                    "role": source["role"],
                    "timestamp": source["timestamp"],
                    "sourceContentHash": sha256_text(source["content"]),
                }
                if any(item.get(key) != value for key, value in expected.items()):
                    raise ValueError(f"Evidence provenance mismatch: {query_id}")
                base = {
                    "memory_id": source["memory_id"],
                    "session_id": source["session_id"],
                    "turn_index": source["turn_index"],
                    "role": source["role"],
                    "timestamp": source["timestamp"],
                }
                excerpt_sources.append({**base, "content": item["content"]})
                parent_sources.append({**base, "content": source["content"]})
            a_prompt = render_prompt(wrap["question"], excerpt_sources)
            if a_prompt != wrap["prompt"]:
                raise ValueError(f"Arm A is not byte-identical: {query_id}")
            full_prompt = render_prompt(wrap["question"], parent_sources)
            expanded = len(full_prompt.encode("utf-8")) <= args.budget_bytes
            b_prompt = full_prompt if expanded else a_prompt
            expanded_by_task[task] += int(expanded)
            rows.append(
                {
                    "task": task,
                    "benchmark_query_id": query_id,
                    "answers": run_row["answer"],
                    "current_output": run_row["output"],
                    "current_official_score": run_row["metrics"]["official_score"],
                    "selected_memory_ids": selected_ids,
                    "source_count": len(selected_ids),
                    "b_expanded": expanded,
                    "a_prompt": a_prompt,
                    "b_prompt": b_prompt,
                    "a_prompt_sha256": sha256_text(a_prompt),
                    "b_prompt_sha256": sha256_text(b_prompt),
                    "a_prompt_utf8_bytes": len(a_prompt.encode("utf-8")),
                    "b_prompt_utf8_bytes": len(b_prompt.encode("utf-8")),
                }
            )
    finally:
        connection.close()

    pair_order = sorted(
        rows,
        key=lambda row: (
            sha256_text(f"{SCHEDULE_SEED}|pair\0{row['benchmark_query_id']}"),
            row["benchmark_query_id"],
        ),
    )
    schedule: list[dict[str, Any]] = []
    for row in pair_order:
        arms = list(ARMS)
        if int(sha256_text(f"{SCHEDULE_SEED}|arm\0{row['benchmark_query_id']}")[:2], 16) % 2:
            arms.reverse()
        for arm in arms:
            schedule.append(
                {
                    "schedule_index": len(schedule),
                    "benchmark_query_id": row["benchmark_query_id"],
                    "arm": arm,
                }
            )

    preparation = {
        "schema_version": 1,
        "experiment": EXPERIMENT,
        "status": "prepared_no_model_calls",
        "source_root": str(source_root),
        "run_label": args.run_label,
        "source_hashes": {name: sha256_file(path) for name, path in paths.items()},
        "budget": {
            "policy": "all selected parents full iff complete rendered prompt fits",
            "utf8_bytes": args.budget_bytes,
        },
        "answer_contract": {
            "model": "gpt-5-mini",
            "system_prompt": SYSTEM_PROMPT,
            "thinking_level": "medium",
            "max_completion_tokens": 4096,
        },
        "selection": {
            "tasks": list(TASKS),
            "questions_per_task": 100,
            "retrieval_rerun": False,
            "gold_used_to_construct_arm_b": False,
            "expanded_by_task": dict(expanded_by_task),
        },
        "schedule_seed": SCHEDULE_SEED,
        "schedule": schedule,
        "rows": rows,
    }
    preparation_path = output / "preparation.json"
    write_json(preparation_path, preparation)
    manifest = {
        "schema_version": 1,
        "status": "PREPARED_NO_MODEL_CALLS",
        "experiment": EXPERIMENT,
        "preparation": str(preparation_path),
        "preparation_sha256": sha256_file(preparation_path),
        "rows": len(rows),
        "units": len(schedule),
        "expanded_by_task": dict(expanded_by_task),
    }
    write_json(output / "PREPARATION_MANIFEST.json", manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def credentials(config_path: Path) -> tuple[str, str]:
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    generation = config["credentials"]["generation"]
    base_url = generation.get("base_url", generation.get("baseUrl"))
    api_key = generation.get("api_key", generation.get("apiKey"))
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise ValueError("Generation credentials are incomplete")
    return base_url.rstrip("/"), api_key


def request_body(contract: dict[str, Any], prompt: str) -> bytes:
    return json.dumps(
        {
            "model": contract["model"],
            "messages": [
                {"role": "system", "content": contract["system_prompt"]},
                {"role": "user", "content": prompt},
            ],
            "reasoning_effort": contract["thinking_level"],
            "max_completion_tokens": contract["max_completion_tokens"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


class RetryableProviderError(RuntimeError):
    pass


def answer_once(
    base_url: str, api_key: str, body: bytes, timeout: float
) -> tuple[str, str, dict[str, Any] | None, str | None]:
    request = Request(
        base_url + "/chat/completions",
        data=body,
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {408, 409, 425, 429} or error.code >= 500:
            raise RetryableProviderError(f"http_{error.code}") from error
        raise
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RetryableProviderError(type(error).__name__) from error
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return "", str(payload.get("model") or "gpt-5-mini"), payload.get("usage"), "malformed_completion"
    if not isinstance(content, str) or not content.strip():
        return "", str(payload.get("model") or "gpt-5-mini"), payload.get("usage"), "empty_completion"
    return content.strip(), str(payload.get("model") or "gpt-5-mini"), payload.get("usage"), None


def run(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    manifest = read_json(output / "PREPARATION_MANIFEST.json")
    preparation_path = Path(manifest["preparation"])
    if sha256_file(preparation_path) != manifest["preparation_sha256"]:
        raise ValueError("Preparation changed after registration")
    preparation = read_json(preparation_path)
    if preparation.get("status") != "prepared_no_model_calls":
        raise ValueError("Preparation status is not runnable")
    base_url, api_key = credentials(args.config)
    contract = preparation["answer_contract"]
    rows = {row["benchmark_query_id"]: row for row in preparation["rows"]}
    schedule = preparation["schedule"]
    results_path = output / "answers.json"
    lock = threading.Lock()
    if results_path.exists():
        results = read_json(results_path)
        if results.get("preparation_sha256") != manifest["preparation_sha256"]:
            raise ValueError("Answer checkpoint belongs to another preparation")
    else:
        results = {
            "schema_version": 1,
            "status": "in_progress",
            "experiment": EXPERIMENT,
            "preparation_sha256": manifest["preparation_sha256"],
            "config_sha256": sha256_file(args.config),
            "sampling": {
                "successful_method_attempts": 1,
                "infrastructure_retry": "same immutable request only",
                "empty_or_malformed_completion": "method failure scored zero",
            },
            "rows": [],
        }
        write_json(results_path, results)
    completed = {
        (row["benchmark_query_id"], row["arm"]): row for row in results["rows"]
    }
    if len(completed) != len(results["rows"]):
        raise ValueError("Duplicate answer checkpoint unit")
    pending = [
        unit
        for unit in schedule
        if (unit["benchmark_query_id"], unit["arm"]) not in completed
    ]

    def execute(unit: dict[str, Any]) -> None:
        prepared = rows[unit["benchmark_query_id"]]
        prompt = prepared["a_prompt"] if unit["arm"] == ARMS[0] else prepared["b_prompt"]
        body = request_body(contract, prompt)
        infrastructure_attempts = 0
        started = time.monotonic()
        while True:
            infrastructure_attempts += 1
            try:
                answer, model, usage, method_failure = answer_once(
                    base_url, api_key, body, args.timeout
                )
                break
            except RetryableProviderError:
                time.sleep(min(2 ** min(infrastructure_attempts - 1, 5), 30) + random.random())
        result = {
            **unit,
            "task": prepared["task"],
            "prompt_sha256": sha256_text(prompt),
            "request_sha256": sha256_bytes(body),
            "output": answer,
            "response_model": model,
            "usage": usage,
            "method_attempts": 1,
            "method_failure": method_failure,
            "infrastructure_attempts": infrastructure_attempts,
            "elapsed_seconds": time.monotonic() - started,
        }
        with lock:
            results["rows"].append(result)
            results["rows"].sort(key=lambda value: value["schedule_index"])
            results["completed_units"] = len(results["rows"])
            write_json(results_path, results)
            done = len(results["rows"])
        if done % 20 == 0 or done == len(schedule):
            print(json.dumps({"completed": done, "total": len(schedule)}), flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(execute, unit) for unit in pending]
        for future in as_completed(futures):
            future.result()
    final = read_json(results_path)
    if len(final["rows"]) != len(schedule):
        raise ValueError("Paired answers are incomplete")
    final["status"] = "complete"
    final["completed_units"] = len(final["rows"])
    write_json(results_path, final)


def exact_mcnemar_p(left_only: int, right_only: int) -> float:
    discordant = left_only + right_only
    if discordant == 0:
        return 1.0
    tail = sum(math.comb(discordant, k) for k in range(min(left_only, right_only) + 1))
    return min(1.0, 2.0 * tail / (2**discordant))


def analyze(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    manifest = read_json(output / "PREPARATION_MANIFEST.json")
    preparation = read_json(Path(manifest["preparation"]))
    answers = read_json(output / "answers.json")
    if answers.get("status") != "complete":
        raise ValueError("Answer experiment is incomplete")
    sys.path.insert(0, str(args.adapter_source.resolve()))
    from mab_adapter.config import task_config  # pylint: disable=import-outside-toplevel
    from mab_adapter.scoring import score_prediction  # pylint: disable=import-outside-toplevel

    prepared = {row["benchmark_query_id"]: row for row in preparation["rows"]}
    generated = {
        (row["benchmark_query_id"], row["arm"]): row for row in answers["rows"]
    }
    summary: dict[str, Any] = {
        "schema_version": 1,
        "experiment": EXPERIMENT,
        "preparation_sha256": manifest["preparation_sha256"],
        "tasks": {},
    }
    for task in TASKS:
        ids = [row["benchmark_query_id"] for row in preparation["rows"] if row["task"] == task]
        paired = {"both": 0, "a_only": 0, "b_only": 0, "neither": 0}
        arm_scores = {arm: 0 for arm in ARMS}
        method_failures = {arm: 0 for arm in ARMS}
        details = []
        for query_id in ids:
            row = prepared[query_id]
            correctness = {}
            metrics_by_arm = {}
            for arm in ARMS:
                result = generated[(query_id, arm)]
                metrics = score_prediction(task_config(task), result["output"], row["answers"])
                correct = float(metrics["official_score"] or 0) > 0
                correctness[arm] = correct
                metrics_by_arm[arm] = metrics
                arm_scores[arm] += int(correct)
                method_failures[arm] += int(result.get("method_failure") is not None)
            key = "both" if all(correctness.values()) else "a_only" if correctness[ARMS[0]] else "b_only" if correctness[ARMS[1]] else "neither"
            paired[key] += 1
            details.append(
                {
                    "benchmark_query_id": query_id,
                    "b_expanded": row["b_expanded"],
                    "a_correct": correctness[ARMS[0]],
                    "b_correct": correctness[ARMS[1]],
                    "a_metrics": metrics_by_arm[ARMS[0]],
                    "b_metrics": metrics_by_arm[ARMS[1]],
                }
            )
        summary["tasks"][task] = {
            "n": len(ids),
            "a_correct": arm_scores[ARMS[0]],
            "b_correct": arm_scores[ARMS[1]],
            "delta_points": arm_scores[ARMS[1]] - arm_scores[ARMS[0]],
            "expanded": sum(prepared[value]["b_expanded"] for value in ids),
            "paired": paired,
            "mcnemar_exact_two_sided_p": exact_mcnemar_p(paired["a_only"], paired["b_only"]),
            "method_failures": method_failures,
            "rows": details,
        }
    aggregate = {
        "n": sum(value["n"] for value in summary["tasks"].values()),
        "a_correct": sum(value["a_correct"] for value in summary["tasks"].values()),
        "b_correct": sum(value["b_correct"] for value in summary["tasks"].values()),
    }
    aggregate["delta_points"] = aggregate["b_correct"] - aggregate["a_correct"]
    aggregate["paired"] = {
        key: sum(value["paired"][key] for value in summary["tasks"].values())
        for key in ("both", "a_only", "b_only", "neither")
    }
    aggregate["mcnemar_exact_two_sided_p"] = exact_mcnemar_p(
        aggregate["paired"]["a_only"], aggregate["paired"]["b_only"]
    )
    summary["aggregate"] = aggregate
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "run", "analyze"))
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--run-label", default="e0-auto-handoff-9task-formal-run1")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--adapter-source", type=Path)
    parser.add_argument("--budget-bytes", type=int, default=128 * 1024)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=180.0)
    args = parser.parse_args()
    if args.mode == "prepare":
        if args.source_root is None:
            parser.error("prepare requires --source-root")
        prepare(args)
    elif args.mode == "run":
        if args.config is None:
            parser.error("run requires --config")
        run(args)
    else:
        if args.adapter_source is None:
            parser.error("analyze requires --adapter-source")
        analyze(args)


if __name__ == "__main__":
    main()
