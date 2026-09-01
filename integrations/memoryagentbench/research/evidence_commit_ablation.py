#!/usr/bin/env python3
"""Fixed-trace E0/E1 evidence-commit ablation for LongMemEval-S.

The preparation stage selects rows only from retrieval traces.  It never uses
gold answers or judge labels to choose evidence.  Read observations intentionally
omit raw source text, so exact parent records are recovered from the locked,
immutable SQLite snapshot and verified against each trace source hash.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
import re
import sqlite3
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

from mab_adapter.load_control import (
    AdaptiveConcurrencyConfig,
    AdaptiveConcurrencyController,
)


SYSTEM_PROMPT = (
    "You are a helpful assistant that can read the context and memorize it "
    "for future retrieval."
)
ARMS = ("e0_all_inspected", "e1_explicit_commit")
ANSWER_MODEL = "gpt-5-mini"
ANSWER_THINKING = "medium"
ANSWER_MAX_TOKENS = 4096
PROMPT_VERSION = (
    "memoryarena-public-committed-evidence-no-summary-no-status-20260831-v1"
)
SCHEDULE_SEED = 0xE01E1


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} is not a JSON object")
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)


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


def utf16_length(value: str) -> int:
    """Match JavaScript String.length used by the TypeScript service."""
    return len(value.encode("utf-16-le")) // 2


def generation_credentials(config_path: Path) -> tuple[str, str]:
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    generation = config["credentials"]["generation"]
    base_url = generation.get("base_url", generation.get("baseUrl"))
    api_key = generation.get("api_key", generation.get("apiKey"))
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise ValueError("Generation credentials are incomplete")
    return base_url.rstrip("/"), api_key


def render_prompt(question: str, memories: Iterable[dict[str, Any]]) -> str:
    sources = list(memories)
    lines = [
        f'<retrieval_package selected_sources="{len(sources)}">',
        "</retrieval_package>",
        '<memory_context authority="committed_exact_sources">',
    ]
    if not sources:
        lines.append("None")
    for source in sources:
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


def first_inspected_ids(wrap: dict[str, Any]) -> list[str]:
    ordered: list[str] = []
    by_id: dict[str, str] = {}
    by_ref: dict[str, str] = {}
    for event in wrap["retrieval"]["trace"]:
        if event["toolName"] != "read":
            continue
        evidence = event["details"]["evidence"]
        references = event["details"]["evidenceReferences"]
        if [row["memoryId"] for row in evidence] != [
            row["memoryId"] for row in references
        ]:
            raise ValueError("Read evidence/reference ordering changed")
        for row in references:
            memory_id = row["memoryId"]
            evidence_ref = row["evidenceRef"]
            if memory_id in by_id and by_id[memory_id] != evidence_ref:
                raise ValueError("Evidence reference changed across repeated reads")
            if evidence_ref in by_ref and by_ref[evidence_ref] != memory_id:
                raise ValueError("Evidence reference collision")
            by_id[memory_id] = evidence_ref
            by_ref[evidence_ref] = memory_id
            if memory_id not in ordered:
                ordered.append(memory_id)
    if any(re.fullmatch(r"E[1-9][0-9]*", by_id[mid]) is None for mid in ordered):
        raise ValueError("Unexpected evidence reference format")
    numeric_order = sorted(ordered, key=lambda mid: int(by_id[mid][1:]))
    if ordered != numeric_order:
        raise ValueError("First inspection order differs from ledger E-ref order")
    return ordered


def committed_ids(wrap: dict[str, Any]) -> list[str]:
    ids = [row["memoryId"] for row in wrap["retrieval"]["evidence"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Committed evidence contains duplicate memory IDs")
    if ids != wrap["selectedMemoryIds"]:
        raise ValueError("Selected memory IDs differ from committed evidence")
    finish = [
        event
        for event in wrap["retrieval"]["trace"]
        if event["toolName"] == "finish"
    ]
    if len(finish) != 1:
        raise ValueError("Expected exactly one finish call")
    finish_ids = [
        row["memoryId"] for row in finish[0]["details"]["committedEvidence"]
    ]
    if ids != finish_ids:
        raise ValueError("Finish evidence order differs from committed evidence")
    return ids


def load_memory_rows(
    database: Path, memory_ids: set[str]
) -> dict[str, dict[str, Any]]:
    connection = sqlite3.connect(
        f"file:{database}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    try:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("SQLite quick_check failed")
        result: dict[str, dict[str, Any]] = {}
        ordered = sorted(memory_ids)
        for offset in range(0, len(ordered), 500):
            batch = ordered[offset : offset + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = connection.execute(
                "SELECT memory_id, scope_id, session_id, turn_index, role, "
                "content, timestamp, content_hash, metadata_json FROM memories "
                f"WHERE memory_id IN ({placeholders})",
                batch,
            )
            result.update({row["memory_id"]: dict(row) for row in rows})
    finally:
        connection.close()
    missing = memory_ids - result.keys()
    if missing:
        raise ValueError(f"SQLite is missing {len(missing)} inspected sources")
    return result


def verify_trace_sources(
    wraps: list[dict[str, Any]], memories: dict[str, dict[str, Any]]
) -> tuple[int, int]:
    occurrences = 0
    truncated = 0
    for wrap in wraps:
        for event in wrap["retrieval"]["trace"]:
            if event["toolName"] != "read":
                continue
            for evidence in event["details"]["evidence"]:
                source = memories[evidence["memoryId"]]
                occurrences += 1
                truncated += int(bool(evidence["truncated"]))
                if evidence["scopeId"] != source["scope_id"]:
                    raise ValueError("Read evidence scope differs from SQLite")
                if evidence["sessionId"] != source["session_id"]:
                    raise ValueError("Read evidence session differs from SQLite")
                if evidence["turnIndex"] != source["turn_index"]:
                    raise ValueError("Read evidence turn differs from SQLite")
                if evidence["sourceContentHash"] != sha256_text(source["content"]):
                    raise ValueError("Read source hash differs from SQLite")
                if evidence["sourceContentLength"] != utf16_length(source["content"]):
                    raise ValueError("Read source length differs from SQLite")
    return occurrences, truncated


def verify_committed_sources(
    wrap: dict[str, Any], memories: dict[str, dict[str, Any]]
) -> None:
    for evidence in wrap["retrieval"]["evidence"]:
        source = memories[evidence["memoryId"]]
        expected = {
            "scopeId": source["scope_id"],
            "sessionId": source["session_id"],
            "turnIndex": source["turn_index"],
            "role": source["role"],
            "timestamp": source["timestamp"],
            "content": source["content"],
            "contentHash": sha256_text(source["content"]),
            "sourceContentHash": sha256_text(source["content"]),
            "sourceContentLength": utf16_length(source["content"]),
        }
        if any(evidence.get(key) != value for key, value in expected.items()):
            raise ValueError("Committed exact source differs from immutable SQLite")


def build_schedule(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rng = random.Random(SCHEDULE_SEED)
    pairs = list(rows)
    rng.shuffle(pairs)
    schedule: list[dict[str, Any]] = []
    for pair_index, row in enumerate(pairs):
        arms = list(ARMS)
        rng.shuffle(arms)
        for arm in arms:
            schedule.append(
                {
                    "schedule_index": len(schedule),
                    "pair_index": pair_index,
                    "benchmark_query_id": row["benchmark_query_id"],
                    "arm": arm,
                }
            )
    return schedule


def prepare(args: argparse.Namespace) -> None:
    artifact = read_json(args.artifact)
    final_manifest = read_json(args.final_manifest)
    prior_judge = read_json(args.prior_judge)
    if artifact.get("completed_queries") != 300 or len(artifact.get("data", [])) != 300:
        raise ValueError("Source run is not the clean full300")
    if artifact.get("answer_prompt_version") != PROMPT_VERSION:
        raise ValueError("Answer prompt version differs from the locked handoff")
    policy = artifact.get("answer_request_policy", {})
    if (
        artifact.get("answer_model"),
        policy.get("thinking_level"),
        policy.get("max_tokens"),
    ) != (ANSWER_MODEL, ANSWER_THINKING, ANSWER_MAX_TOKENS):
        raise ValueError("Answer model/config differs from the locked run")
    base_url, _api_key = generation_credentials(args.config)
    if artifact.get("answer_base_url", "").rstrip("/") != base_url:
        raise ValueError("Generation endpoint differs from the locked run")
    source_hashes = {
        "artifact": sha256_file(args.artifact),
        "wrap_audit": sha256_file(args.wrap_audit),
        "database": sha256_file(args.database),
        "final_manifest": sha256_file(args.final_manifest),
        "config": sha256_file(args.config),
        "prior_judge": sha256_file(args.prior_judge),
        "script": sha256_file(Path(__file__)),
    }
    locked_artifacts = final_manifest["artifacts"]
    if source_hashes["artifact"] != locked_artifacts["run"]["sha256"]:
        raise ValueError("Source artifact hash differs from FINAL_MANIFEST")
    if source_hashes["wrap_audit"] != locked_artifacts["wrap_audit"]["sha256"]:
        raise ValueError("Wrap audit hash differs from FINAL_MANIFEST")
    if source_hashes["database"] != final_manifest["ingestion"]["sqlite_sha256"]:
        raise ValueError("SQLite hash differs from FINAL_MANIFEST")
    if source_hashes["config"] != final_manifest["config"]["sha256"]:
        raise ValueError("Config hash differs from FINAL_MANIFEST")

    users = artifact["context_ingestion_users"]
    rows_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in artifact["data"]:
        rows_by_key[(users[str(row["context_id"])], row["query"])].append(row)
    if len(rows_by_key) != 300 or any(len(rows) != 1 for rows in rows_by_key.values()):
        raise ValueError("Run rows do not have unique (user, query) join keys")

    wraps: list[dict[str, Any]] = []
    with args.wrap_audit.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                wraps.append(json.loads(line))
    if len(wraps) != 300:
        raise ValueError("Expected 300 wrap audits")
    wrap_rows: list[tuple[dict[str, Any], dict[str, Any], list[str], list[str]]] = []
    all_ids: set[str] = set()
    for wrap in wraps:
        matches = rows_by_key.get((wrap["userId"], wrap["question"]), [])
        if len(matches) != 1:
            raise ValueError("Wrap audit does not join 1:1 with a run row")
        inspected = first_inspected_ids(wrap)
        committed = committed_ids(wrap)
        if not set(committed).issubset(inspected):
            raise ValueError("Committed evidence is not a subset of inspected evidence")
        if len(inspected) != wrap["retrieval"]["audit"]["metrics"]["inspectedEvidenceCount"]:
            raise ValueError("Inspected evidence metric changed")
        if len(committed) != wrap["retrieval"]["audit"]["metrics"]["evidenceCount"]:
            raise ValueError("Committed evidence metric changed")
        all_ids.update(inspected)
        all_ids.update(committed)
        wrap_rows.append((wrap, matches[0], inspected, committed))

    memories = load_memory_rows(args.database, all_ids)
    read_occurrences, truncated_occurrences = verify_trace_sources(wraps, memories)
    eligible: list[dict[str, Any]] = []
    reorder_only: list[str] = []
    e1_byte_checks = 0
    for wrap, row, inspected, committed in wrap_rows:
        verify_committed_sources(wrap, memories)
        e1_prompt = render_prompt(
            wrap["question"], [memories[memory_id] for memory_id in committed]
        )
        if e1_prompt != wrap["prompt"]:
            raise ValueError("Reconstructed E1 prompt differs from saved wrap prompt")
        e1_byte_checks += 1
        if set(inspected) == set(committed):
            if inspected != committed:
                reorder_only.append(row["benchmark_query_id"])
            continue
        e0_prompt = render_prompt(
            wrap["question"], [memories[memory_id] for memory_id in inspected]
        )
        if "retrieval_summary" in e0_prompt or "status=" in e0_prompt:
            raise ValueError("E0 prompt contains summary or status")
        eligible.append(
            {
                "benchmark_query_id": row["benchmark_query_id"],
                "context_id": row["context_id"],
                "qa_pair_id": row["qa_pair_id"],
                "question_id": row["question_id"],
                "question_type": row["question_type"],
                "inspected_memory_ids": inspected,
                "committed_memory_ids": committed,
                "inspected_count": len(inspected),
                "committed_count": len(committed),
                "uncommitted_count": len(inspected) - len(committed),
                "e0_prompt": e0_prompt,
                "e1_prompt": e1_prompt,
                "e0_prompt_sha256": sha256_text(e0_prompt),
                "e1_prompt_sha256": sha256_text(e1_prompt),
                "e0_prompt_utf8_bytes": len(e0_prompt.encode("utf-8")),
                "e1_prompt_utf8_bytes": len(e1_prompt.encode("utf-8")),
            }
        )
    eligible.sort(key=lambda row: row["benchmark_query_id"])
    reorder_only.sort()
    if len(eligible) != 227 or len(reorder_only) != 9 or e1_byte_checks != 300:
        raise ValueError("Eligibility or E1 byte-check count changed")
    schedule = build_schedule(eligible)
    preparation = {
        "schema_version": 1,
        "experiment": "fixed-trace-evidence-commit-e0-e1",
        "selection": {
            "rule": "set(all first-seen read evidence memory IDs) != set(committed evidence memory IDs)",
            "uses_gold": False,
            "eligible_count": len(eligible),
            "reorder_only_excluded_count": len(reorder_only),
            "reorder_only_excluded_ids": reorder_only,
        },
        "ordering": {
            ARMS[0]: "first inspection order, equal to numeric ledger E-ref order",
            ARMS[1]: "current finish committed-evidence order",
        },
        "source_hashes": source_hashes,
        "answer": {
            "model": ANSWER_MODEL,
            "thinking_level": ANSWER_THINKING,
            "max_completion_tokens": ANSWER_MAX_TOKENS,
            "system_prompt": SYSTEM_PROMPT,
            "system_prompt_sha256": sha256_text(SYSTEM_PROMPT),
            "answer_prompt_version": PROMPT_VERSION,
            "base_url_sha256": sha256_text(base_url),
        },
        "integrity": {
            "joined_rows": len(wrap_rows),
            "unique_memory_ids": len(all_ids),
            "read_evidence_occurrences": read_occurrences,
            "truncated_read_occurrences_recovered_from_parent": truncated_occurrences,
            "e1_prompt_byte_checks": e1_byte_checks,
            "sqlite_mode": "ro,immutable=1",
        },
        "schedule_seed": SCHEDULE_SEED,
        "schedule": schedule,
        "rows": eligible,
    }
    preparation_path = args.output / "preparation" / "eligibility-and-prompts.json"
    write_json(preparation_path, preparation)
    manifest = {
        "schema_version": 1,
        "status": "prepared_answers_pending",
        "experiment": preparation["experiment"],
        "selection_uses_gold": False,
        "eligible_count": len(eligible),
        "answer_units": len(schedule),
        "reorder_only_excluded_count": len(reorder_only),
        "e1_prompt_byte_checks": e1_byte_checks,
        "preparation": str(preparation_path.resolve()),
        "preparation_sha256": sha256_file(preparation_path),
        "source_hashes": source_hashes,
    }
    manifest_path = args.output / "PREPARATION_MANIFEST.json"
    write_json(manifest_path, manifest)
    checksums = args.output / "PREPARATION_SHA256SUMS"
    checksums.write_text(
        "".join(
            f"{sha256_file(path)}  {path.resolve()}\n"
            for path in (Path(__file__), preparation_path, manifest_path)
        ),
        encoding="utf-8",
    )
    os.chmod(checksums, 0o600)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


class RetryableAnswerError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class FatalAnswerError(RuntimeError):
    pass


def answer_once(
    *, base_url: str, api_key: str, prompt: str, timeout: float
) -> tuple[str, str]:
    payload = json.dumps(
        {
            "model": ANSWER_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "reasoning_effort": ANSWER_THINKING,
            "max_completion_tokens": ANSWER_MAX_TOKENS,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        base_url + "/chat/completions",
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
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {408, 409, 425, 429} or error.code >= 500:
            raise RetryableAnswerError(
                f"retryable HTTP {error.code}", status=error.code
            ) from error
        raise FatalAnswerError(f"non-retryable HTTP {error.code}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RetryableAnswerError(type(error).__name__) from error
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RetryableAnswerError("malformed completion") from error
    if not isinstance(content, str) or not content.strip():
        raise RetryableAnswerError("empty completion")
    response_model = body.get("model")
    return content.strip(), response_model if isinstance(response_model, str) else ANSWER_MODEL


def validate_preparation(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = read_json(args.output / "PREPARATION_MANIFEST.json")
    preparation_path = Path(manifest["preparation"])
    if sha256_file(preparation_path) != manifest["preparation_sha256"]:
        raise ValueError("Preparation hash changed")
    preparation = read_json(preparation_path)
    if preparation["selection"]["uses_gold"] is not False:
        raise ValueError("Eligibility manifest is not gold-free")
    if preparation["integrity"]["e1_prompt_byte_checks"] != 300:
        raise ValueError("E1 300/300 byte-check is missing")
    if len(preparation["rows"]) != 227 or len(preparation["schedule"]) != 454:
        raise ValueError("Prepared answer unit count changed")
    if sha256_file(args.config) != manifest["source_hashes"]["config"]:
        raise ValueError("Generation config changed after preparation")
    return manifest, preparation


def run_answers(args: argparse.Namespace) -> None:
    manifest, preparation = validate_preparation(args)
    base_url, api_key = generation_credentials(args.config)
    if sha256_text(base_url) != preparation["answer"]["base_url_sha256"]:
        raise ValueError("Generation endpoint changed after preparation")
    rows = {row["benchmark_query_id"]: row for row in preparation["rows"]}
    schedule = preparation["schedule"]
    results_path = args.output / "answers" / "answer-results.json"
    if results_path.exists():
        results = read_json(results_path)
        if results.get("preparation_sha256") != manifest["preparation_sha256"]:
            raise ValueError("Answer resume preparation identity changed")
    else:
        results = {
            "schema_version": 1,
            "experiment": preparation["experiment"],
            "preparation_sha256": manifest["preparation_sha256"],
            "fresh_paired_answers": True,
            "scheduler": {
                "unit_order": "question pairs adjacent; within-pair arm order seeded and random",
                "workers": 8,
                "adaptive": {
                    "minimum": 1,
                    "initial": 4,
                    "maximum": 8,
                    "successes_per_increase": 8,
                },
                "retry_policy": "unbounded retryable infrastructure failures; never scored as wrong",
            },
            "answer": preparation["answer"],
            "rows": [],
        }
        write_json(results_path, results)
    completed = {
        (row["benchmark_query_id"], row["arm"]): row for row in results["rows"]
    }
    controller = AdaptiveConcurrencyController(
        AdaptiveConcurrencyConfig(
            minimum=1, initial=4, maximum=8, successes_per_increase=8
        )
    )
    lock = threading.Lock()

    def execute(unit: dict[str, Any]) -> dict[str, Any]:
        row = rows[unit["benchmark_query_id"]]
        prompt = row["e0_prompt"] if unit["arm"] == ARMS[0] else row["e1_prompt"]
        expected_hash = row[
            "e0_prompt_sha256" if unit["arm"] == ARMS[0] else "e1_prompt_sha256"
        ]
        if sha256_text(prompt) != expected_hash:
            raise ValueError("Scheduled prompt hash changed")
        attempts = 0
        started = time.monotonic()
        while True:
            attempts += 1
            lease = controller.acquire()
            assert lease is not None
            try:
                output, response_model = answer_once(
                    base_url=base_url,
                    api_key=api_key,
                    prompt=prompt,
                    timeout=120.0,
                )
            except RetryableAnswerError as error:
                controller.failed(
                    lease,
                    "answer",
                    retryable=True,
                    http_status=error.status,
                    error_code=type(error).__name__,
                )
                delay = min(2 ** min(attempts - 1, 5), 30)
                time.sleep(delay + random.random() * min(1.0, delay / 4))
                continue
            except BaseException:
                controller.failed(lease, "answer", retryable=False)
                raise
            controller.succeeded(lease, "answer")
            return {
                **unit,
                "prompt_sha256": expected_hash,
                "output": output,
                "response_model": response_model,
                "attempts": attempts,
                "elapsed_seconds": time.monotonic() - started,
            }

    pending = [
        unit
        for unit in schedule
        if (unit["benchmark_query_id"], unit["arm"]) not in completed
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(execute, unit) for unit in pending]
        for future in as_completed(futures):
            row = future.result()
            with lock:
                results["rows"].append(row)
                results["rows"].sort(key=lambda value: value["schedule_index"])
                results["adaptive_state"] = controller.snapshot()
                write_json(results_path, results)
                done = len(results["rows"])
            if done % 10 == 0 or done == len(schedule):
                print(
                    json.dumps(
                        {
                            "completed": done,
                            "total": len(schedule),
                            "adaptive": controller.snapshot(),
                        }
                    ),
                    flush=True,
                )
    if len(results["rows"]) != 454:
        raise ValueError("Fresh paired answer set is incomplete")
    response_keys = {
        (row["benchmark_query_id"], row["arm"]) for row in results["rows"]
    }
    expected_keys = {
        (row["benchmark_query_id"], arm)
        for row in preparation["rows"]
        for arm in ARMS
    }
    if response_keys != expected_keys:
        raise ValueError("Fresh paired answer identities are incomplete")

    artifact = read_json(args.artifact)
    prior_judge = read_json(args.prior_judge)
    target_ids = set(rows)
    answer_rows = {
        (row["benchmark_query_id"], row["arm"]): row for row in results["rows"]
    }
    for arm in ARMS:
        source = copy.deepcopy(artifact)
        source["evidence_commit_ablation"] = {
            "experiment": preparation["experiment"],
            "arm": arm,
            "target_count": len(target_ids),
            "unaffected_reused_count": 300 - len(target_ids),
            "selection_uses_gold": False,
            "preparation_sha256": manifest["preparation_sha256"],
            "formal_end_to_end_score": False,
        }
        if arm == ARMS[0]:
            source["answer_prompt_version"] = (
                "counterfactual-all-inspected-exact-no-summary-no-status-20260831-v1"
            )
        for source_row in source["data"]:
            query_id = source_row["benchmark_query_id"]
            if query_id in target_ids:
                answer_row = answer_rows[(query_id, arm)]
                source_row["historical_output"] = source_row["output"]
                source_row["output"] = answer_row["output"]
                source_row["evidence_commit_ablation"] = {
                    "arm": arm,
                    "prompt_sha256": answer_row["prompt_sha256"],
                    "response_model": answer_row["response_model"],
                    "attempts": answer_row["attempts"],
                }
            else:
                source_row["evidence_commit_ablation"] = {
                    "arm": arm,
                    "eligible": False,
                    "output_source": "reused-original-identical-arm-input",
                }
        source_path = args.output / "judge-sources" / arm / "longmemeval-s-static.json"
        write_json(source_path, source)
        seeded = {
            **{key: value for key, value in prior_judge.items() if key != "data"},
            "source_artifact": str(source_path.resolve()),
            "data": [
                row
                for row in prior_judge["data"]
                if row["benchmark_query_id"] not in target_ids
            ],
            "summary": {
                "note": "73 unchanged-output rows seeded from the locked prior official judge; 227 fresh outputs pending"
            },
        }
        write_json(
            args.output / "evaluation" / arm / "longmemeval-s-static.json",
            seeded,
        )
    manifest["status"] = "answers_complete_judge_pending"
    manifest["answers"] = str(results_path.resolve())
    manifest["answers_sha256"] = sha256_file(results_path)
    manifest["adaptive_state"] = results["adaptive_state"]
    write_json(args.output / "RUN_MANIFEST.json", manifest)
    print(json.dumps({"status": manifest["status"], "answers": 454}, indent=2))


def exact_mcnemar(e0_only: int, e1_only: int) -> float:
    discordant = e0_only + e1_only
    if discordant == 0:
        return 1.0
    tail = sum(math.comb(discordant, index) for index in range(min(e0_only, e1_only) + 1))
    return min(1.0, 2.0 * tail / (2**discordant))


def paired_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    both = sum(row[ARMS[0]] and row[ARMS[1]] for row in rows)
    e0_only = sum(row[ARMS[0]] and not row[ARMS[1]] for row in rows)
    e1_only = sum(not row[ARMS[0]] and row[ARMS[1]] for row in rows)
    neither = len(rows) - both - e0_only - e1_only
    e0_correct = both + e0_only
    e1_correct = both + e1_only
    return {
        "count": len(rows),
        ARMS[0]: {
            "correct": e0_correct,
            "accuracy": e0_correct / len(rows) if rows else None,
        },
        ARMS[1]: {
            "correct": e1_correct,
            "accuracy": e1_correct / len(rows) if rows else None,
        },
        "delta_e1_minus_e0": (e1_correct - e0_correct) / len(rows) if rows else None,
        "paired_flips": {
            "both_correct": both,
            "e0_only": e0_only,
            "e1_only": e1_only,
            "neither": neither,
        },
        "mcnemar_exact_two_sided_p": exact_mcnemar(e0_only, e1_only),
    }


def fixed_bucket(value: int) -> str:
    if value <= 2:
        return "1-2"
    if value <= 4:
        return "3-4"
    if value <= 8:
        return "5-8"
    return "9+"


def finalize(args: argparse.Namespace) -> None:
    manifest, preparation = validate_preparation(args)
    answers = read_json(args.output / "answers" / "answer-results.json")
    if len(answers["rows"]) != 454:
        raise ValueError("Paired answers are incomplete")
    original_judge = read_json(args.prior_judge)
    original_labels = {
        row["benchmark_query_id"]: bool(row["label"])
        for row in original_judge["data"]
    }
    judged: dict[str, dict[str, bool]] = {}
    judge_hashes: dict[str, str] = {}
    for arm in ARMS:
        path = args.output / "evaluation" / arm / "longmemeval-s-static.json"
        value = read_json(path)
        if value.get("judge_model") != "gpt-4o":
            raise ValueError("Judge model changed")
        if value.get("prompt_sha256") != original_judge.get("prompt_sha256"):
            raise ValueError("Official judge prompt changed")
        if len(value.get("data", [])) != 300:
            raise ValueError("Official judge output is incomplete")
        judged[arm] = {
            row["benchmark_query_id"]: bool(row["label"])
            for row in value["data"]
        }
        judge_hashes[arm] = sha256_file(path)
    answer_rows = {
        (row["benchmark_query_id"], row["arm"]): row for row in answers["rows"]
    }
    paired: list[dict[str, Any]] = []
    for row in preparation["rows"]:
        query_id = row["benchmark_query_id"]
        paired.append(
            {
                "benchmark_query_id": query_id,
                "question_id": row["question_id"],
                "question_type": row["question_type"],
                "inspected_count": row["inspected_count"],
                "committed_count": row["committed_count"],
                "uncommitted_count": row["uncommitted_count"],
                "original_final": original_labels[query_id],
                ARMS[0]: judged[ARMS[0]][query_id],
                ARMS[1]: judged[ARMS[1]][query_id],
                "answer_attempts": {
                    arm: answer_rows[(query_id, arm)]["attempts"] for arm in ARMS
                },
            }
        )
    by_type = {
        key: paired_summary(value)
        for key, value in sorted(
            (
                (key, [row for row in paired if row["question_type"] == key])
                for key in {row["question_type"] for row in paired}
            )
        )
    }
    by_inspected: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_noise: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in paired:
        by_inspected[fixed_bucket(row["inspected_count"])].append(row)
        by_noise[fixed_bucket(row["uncommitted_count"])].append(row)
    flip_groups: dict[str, list[int]] = defaultdict(list)
    for row in paired:
        if row[ARMS[0]] and row[ARMS[1]]:
            key = "both_correct"
        elif row[ARMS[0]]:
            key = "e0_only"
        elif row[ARMS[1]]:
            key = "e1_only"
        else:
            key = "neither"
        flip_groups[key].append(row["uncommitted_count"])

    patterns = Counter(
        f"O{int(row['original_final'])}_E0{int(row[ARMS[0]])}_E1{int(row[ARMS[1]])}"
        for row in paired
    )
    original_as_e0e1 = [
        {
            **row,
            "original_arm": row["original_final"],
        }
        for row in paired
    ]
    original_vs_e1 = []
    original_vs_e0 = []
    for row in paired:
        original_vs_e1.append(
            {**row, ARMS[0]: row["original_final"], ARMS[1]: row[ARMS[1]]}
        )
        original_vs_e0.append(
            {**row, ARMS[0]: row["original_final"], ARMS[1]: row[ARMS[0]]}
        )
    stable = [row for row in paired if row["original_final"] == row[ARMS[1]]]
    original_strata = {
        str(label).lower(): paired_summary(
            [row for row in paired if row["original_final"] is label]
        )
        for label in (False, True)
    }
    summary = {
        "schema_version": 1,
        "experiment": preparation["experiment"],
        "interpretation": (
            "Conditional fixed-retrieval-trace answer-handoff ablation on 227 rows; "
            "not an end-to-end PiMem score. Eligibility and evidence use no gold."
        ),
        "primary": paired_summary(paired),
        "by_question_type": by_type,
        "by_inspected_count": {
            key: paired_summary(rows) for key, rows in sorted(by_inspected.items())
        },
        "by_uncommitted_noise_count": {
            key: paired_summary(rows) for key, rows in sorted(by_noise.items())
        },
        "mean_uncommitted_count_by_flip": {
            key: sum(values) / len(values) for key, values in sorted(flip_groups.items())
        },
        "original_final_three_way_sensitivity": {
            "patterns": dict(sorted(patterns.items())),
            "fresh_e1_vs_original_same_prompt_replication": paired_summary(original_vs_e1),
            "fresh_e0_vs_original": paired_summary(original_vs_e0),
            "original_strata": original_strata,
            "original_and_fresh_e1_agree": {
                "count": len(stable),
                "fraction": len(stable) / len(paired),
                "e0_vs_stable_e1": paired_summary(stable),
            },
        },
        "reorder_only": {
            "count": preparation["selection"]["reorder_only_excluded_count"],
            "included_in_main_effect": False,
            "model_calls": 0,
        },
        "infrastructure": {
            "answer_adaptive_state": answers.get("adaptive_state"),
            "answer_attempt_distribution": dict(
                sorted(Counter(row["attempts"] for row in answers["rows"]).items())
            ),
            "answer_response_models": sorted(
                {row["response_model"] for row in answers["rows"]}
            ),
            "judge_hashes": judge_hashes,
        },
        "paired": paired,
    }
    summary_path = args.output / "summary.json"
    write_json(summary_path, summary)
    run_manifest = read_json(args.output / "RUN_MANIFEST.json")
    run_manifest["status"] = "complete"
    run_manifest["summary"] = str(summary_path.resolve())
    run_manifest["summary_sha256"] = sha256_file(summary_path)
    run_manifest["judge_hashes"] = judge_hashes
    write_json(args.output / "FINAL_MANIFEST.json", run_manifest)
    print(json.dumps(summary["primary"], ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("prepare", "answer", "finalize"), required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--wrap-audit", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--final-manifest", type=Path, required=True)
    parser.add_argument("--prior-judge", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.mode == "prepare":
        prepare(args)
    elif args.mode == "answer":
        run_answers(args)
    else:
        finalize(args)


if __name__ == "__main__":
    main()
