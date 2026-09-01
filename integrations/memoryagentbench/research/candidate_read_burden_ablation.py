#!/usr/bin/env python3
"""Prepare a fixed-trace candidate read-burden diagnostic.

This module performs no model or judge calls.  Eligibility is deliberately
gold-conditioned, but both answer arms are rendered from trace-only policies:

* A: the exact source package read by the Agent in the frozen E0 run;
* B: A followed by deterministic production evidence projections for the first
  four unread parents on the first successful search's full-result page.

Candidate passages in the current audit do not carry byte spans or source
hashes.  The preparation therefore refuses to call them exact passages.  It
recovers exact parents by stable memory ID from the locked immutable SQLite
database, verifies all candidate metadata present in the trace, and calls the
frozen production ``projectMemoryEvidenceBatch`` implementation.  No projector
algorithm is copied into this research script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


EXPERIMENT = "fixed-trace-candidate-read-burden-a-b-v1"
ANSWER_SYSTEM_PROMPT = (
    "You are a helpful assistant that can read the context and memorize it "
    "for future retrieval."
)
ANSWER_MODEL = "gpt-5-mini"
ANSWER_THINKING = "medium"
ANSWER_MAX_TOKENS = 4096
ANSWER_PROMPT_VERSION = (
    "memoryarena-public-read-evidence-no-summary-no-status-20260831-v2"
)
JUDGE_MODEL = "gpt-4o"
JUDGE_PROMPT_SHA256 = (
    "2c90b57efc5142071e32e10b3b131bbad6ee37626b6287d007ab1f52a2cdf54d"
)
TARGET_STAGE = "candidate_all_not_read"
GUARD_STAGE = "all_gold_read_answer_correct"
GUARD_SIZE = 40
GUARD_SEED = "candidate-read-burden-ablation-v1|guard|sha256"
SCHEDULE_SEED = "candidate-read-burden-ablation-v1|paired-schedule|sha256"
EXTRA_PARENT_COUNT = 4
TOTAL_SOURCE_CAP = 32


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


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def utf16_slice(value: str, start: int, end: int) -> str:
    encoded = value.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


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


def render_prompt(question: str, memories: Iterable[dict[str, Any]]) -> str:
    sources = list(memories)
    lines = [
        f'<retrieval_package selected_sources="{len(sources)}">',
        "</retrieval_package>",
        '<memory_context authority="read_exact_sources">',
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


def hash_order(seed: str, identifier: str) -> tuple[str, str]:
    return sha256_text(f"{seed}\0{identifier}"), identifier


def ordered_ids_sha256(values: list[str]) -> str:
    return sha256_text("".join(f"{value}\n" for value in values))


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        raise ValueError("Cannot take percentile of empty values")
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def size_summary(values: list[int]) -> dict[str, float | int]:
    return {
        "minimum": min(values),
        "median": percentile(values, 0.5),
        "p90": percentile(values, 0.9),
        "maximum": max(values),
        "mean": sum(values) / len(values),
        "total": sum(values),
    }


def load_rows(
    connection: sqlite3.Connection, memory_ids: set[str]
) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    ordered = sorted(memory_ids)
    for offset in range(0, len(ordered), 500):
        batch = ordered[offset : offset + 500]
        placeholders = ",".join("?" for _ in batch)
        result = connection.execute(
            "SELECT memory_id, scope_id, session_id, turn_index, role, content, "
            "timestamp, content_hash, metadata_json FROM memories WHERE "
            f"memory_id IN ({placeholders})",
            batch,
        )
        rows.update({row["memory_id"]: dict(row) for row in result})
    missing = memory_ids - rows.keys()
    if missing:
        raise ValueError(f"SQLite is missing {len(missing)} referenced parents")
    for row in rows.values():
        content_hash = sha256_text(row["content"])
        if row["content_hash"] != content_hash:
            raise ValueError("SQLite content hash does not match exact parent content")
    return rows


def production_record(source: dict[str, Any]) -> dict[str, Any]:
    value = {
        "memoryId": source["memory_id"],
        "scopeId": source["scope_id"],
        "sessionId": source["session_id"],
        "turnIndex": source["turn_index"],
        "role": source["role"],
        "content": source["content"],
        "contentHash": source["content_hash"],
        "metadata": json.loads(source["metadata_json"]),
    }
    if source["timestamp"] is not None:
        value["timestamp"] = source["timestamp"]
    return value


def candidate_focus(question: str, candidate: dict[str, Any]) -> list[str]:
    values = [question]
    values.extend(
        discovery["query"]
        for discovery in candidate.get("discoveries", [])
        if isinstance(discovery.get("query"), str) and discovery["query"].strip()
    )
    return list(dict.fromkeys(values))


def invoke_production_projector(
    *,
    helper: Path,
    runtime_source: Path,
    node_container_image: str,
    batches: list[dict[str, Any]],
) -> dict[str, Any]:
    source_parent = runtime_source.parent
    command = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--user",
        "0:0",
        "--entrypoint",
        "node",
        "-v",
        f"{source_parent}:{source_parent}:ro",
        "-v",
        f"{helper}:{helper}:ro",
        node_container_image,
        str(helper),
        "--runtime-source",
        str(runtime_source),
    ]
    result = subprocess.run(
        command,
        input=json.dumps({"batches": batches}, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError(
            "Frozen production evidence projector failed: "
            + result.stderr.strip()[:2_000]
        )
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or not isinstance(value.get("batches"), list):
        raise ValueError("Frozen projector returned an invalid result")
    return value


def container_image_identity(image: str) -> str:
    result = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip().startswith("sha256:"):
        raise ValueError("Node container image identity cannot be locked")
    return result.stdout.strip()


def successful_first_search(wrap: dict[str, Any]) -> dict[str, Any]:
    matches = [
        event
        for event in wrap["retrieval"]["trace"]
        if event.get("toolName") == "search"
        and event.get("isError") is False
        and event.get("details", {}).get("kind") == "search"
    ]
    if not matches:
        raise ValueError("Eligible trace has no successful search")
    return matches[0]


def render_evidence_excerpts(item: dict[str, Any]) -> str:
    excerpts = item["excerpts"]
    length = item["sourceContentLength"]
    if len(excerpts) == 1 and excerpts[0]["start"] == 0 and excerpts[0]["end"] == length:
        return excerpts[0]["content"]
    separator = (
        "\n\n[… source content omitted; read this candidate again if another "
        "passage is needed …]\n\n"
    )
    return separator.join(
        f"[source chars {excerpt['start']}-{excerpt['end']} of {length}]\n"
        f"{excerpt['content']}"
        for excerpt in excerpts
    )


def verify_read_evidence(
    wrap: dict[str, Any], memories: dict[str, dict[str, Any]]
) -> tuple[list[str], list[dict[str, Any]], int]:
    evidence = wrap["retrieval"]["evidence"]
    ids = [row["memoryId"] for row in evidence]
    if len(ids) != len(set(ids)):
        raise ValueError("Current E0 package contains duplicate memory IDs")
    if ids != wrap["selectedMemoryIds"]:
        raise ValueError("Current selected IDs differ from exact evidence order")
    truncated = 0
    prompt_sources: list[dict[str, Any]] = []
    for item in evidence:
        source = memories[item["memoryId"]]
        expected = {
            "scopeId": source["scope_id"],
            "sessionId": source["session_id"],
            "turnIndex": source["turn_index"],
            "role": source["role"],
            "timestamp": source["timestamp"],
            "sourceContentHash": sha256_text(source["content"]),
            "sourceContentLength": utf16_length(source["content"]),
        }
        if any(item.get(key) != value for key, value in expected.items()):
            raise ValueError("Current exact read evidence differs from SQLite")
        excerpts = item.get("excerpts")
        if not isinstance(excerpts, list) or not excerpts:
            raise ValueError("Current read evidence lacks exact excerpt provenance")
        previous_end = -1
        for excerpt in excerpts:
            start, end = excerpt.get("start"), excerpt.get("end")
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or start < 0
                or end < start
                or end > expected["sourceContentLength"]
                or start < previous_end
            ):
                raise ValueError("Current read evidence has an invalid excerpt span")
            if excerpt.get("content") != utf16_slice(source["content"], start, end):
                raise ValueError("Current read excerpt is not exact source text")
            previous_end = end
        rendered = render_evidence_excerpts(item)
        if rendered != item.get("content") or sha256_text(rendered) != item.get("contentHash"):
            raise ValueError("Current bounded exact excerpt payload changed")
        expected_truncated = not (
            len(excerpts) == 1
            and excerpts[0]["start"] == 0
            and excerpts[0]["end"] == expected["sourceContentLength"]
        )
        if bool(item.get("truncated")) != expected_truncated:
            raise ValueError("Current evidence truncation flag differs from exact spans")
        truncated += int(expected_truncated)
        prompt_sources.append(
            {
                "memory_id": source["memory_id"],
                "session_id": source["session_id"],
                "turn_index": source["turn_index"],
                "role": source["role"],
                "timestamp": source["timestamp"],
                "content": rendered,
            }
        )
    return ids, prompt_sources, truncated


def verify_projected_evidence(
    evidence: list[dict[str, Any]],
    expected_ids: list[str],
    memories: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    if [item.get("memoryId") for item in evidence] != expected_ids:
        raise ValueError("Production projector changed registered parent order")
    prompt_sources: list[dict[str, Any]] = []
    truncated = 0
    for item in evidence:
        source = memories[item["memoryId"]]
        expected = {
            "scopeId": source["scope_id"],
            "sessionId": source["session_id"],
            "turnIndex": source["turn_index"],
            "role": source["role"],
            "timestamp": source["timestamp"],
            "sourceContentHash": sha256_text(source["content"]),
            "sourceContentLength": utf16_length(source["content"]),
        }
        if any(item.get(key) != value for key, value in expected.items()):
            raise ValueError("Projected evidence provenance differs from immutable parent")
        if sha256_text(item.get("content", "")) != item.get("contentHash"):
            raise ValueError("Projected evidence content hash changed")
        excerpts = item.get("excerpts")
        if not isinstance(excerpts, list) or not excerpts:
            raise ValueError("Projected evidence lacks exact excerpt spans")
        previous_end = -1
        for excerpt in excerpts:
            start, end = excerpt.get("start"), excerpt.get("end")
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or start < 0
                or end < start
                or end > expected["sourceContentLength"]
                or start < previous_end
                or excerpt.get("content")
                != utf16_slice(source["content"], start, end)
            ):
                raise ValueError("Projected evidence span is not exact source text")
            previous_end = end
        expected_truncated = not (
            len(excerpts) == 1
            and excerpts[0]["start"] == 0
            and excerpts[0]["end"] == expected["sourceContentLength"]
        )
        if bool(item.get("truncated")) != expected_truncated:
            raise ValueError("Projected evidence truncation flag changed")
        truncated += int(expected_truncated)
        prompt_sources.append(
            {
                "memory_id": source["memory_id"],
                "session_id": source["session_id"],
                "turn_index": source["turn_index"],
                "role": source["role"],
                "timestamp": source["timestamp"],
                "content": item["content"],
            }
        )
    return prompt_sources, truncated


def source_paths(root: Path) -> dict[str, Path]:
    return {
        "run": root
        / "runs/e0-auto-handoff-formal-full300-run1/longmemeval-s-static.json",
        "wrap_audit": root / "runtime/memory-service/wrap-audits.jsonl",
        "database": root / "runtime/memory-service/memory.sqlite",
        "stage_diagnostic": root / "audits/gold-stage-mechanism-diagnostic.json",
        "judge": root / "evaluation/gpt4o-official/longmemeval-s-static.json",
    }


def prepare(
    root: Path,
    output: Path,
    runtime_source: Path,
    projection_helper: Path,
    node_container_image: str,
) -> dict[str, Any]:
    paths = source_paths(root)
    projector_module = runtime_source / "dist/evidence-agent/index.js"
    if any(not path.is_file() for path in paths.values()):
        missing = [name for name, path in paths.items() if not path.is_file()]
        raise ValueError(f"Missing source artifacts: {missing}")
    if not projection_helper.is_file() or not projector_module.is_file():
        raise ValueError("Frozen production projector or research helper is missing")
    locked_paths = {
        **paths,
        "projection_helper": projection_helper,
        "production_projector_module": projector_module,
    }
    source_hashes = {
        name: sha256_file(path) for name, path in locked_paths.items()
    }
    node_image_id = container_image_identity(node_container_image)
    artifact = read_json(paths["run"])
    stage = read_json(paths["stage_diagnostic"])
    judge = read_json(paths["judge"])
    lock = stage["source_lock"]
    expected_locks = {
        "run": lock["run"]["sha256"],
        "wrap_audit": lock["wrap_audit"]["sha256"],
        "database": lock["database_sha256"],
        "judge": lock["judge"]["sha256"],
    }
    for name, expected in expected_locks.items():
        if source_hashes[name] != expected:
            raise ValueError(f"{name} changed after the stage diagnostic")
    if judge.get("source_artifact_sha256") != source_hashes["run"]:
        raise ValueError("Official judge is not bound to the frozen E0 run")
    if (
        artifact.get("completed_queries"),
        len(artifact.get("data", [])),
        artifact.get("answer_model"),
        artifact.get("answer_prompt_version"),
        artifact.get("answer_request_policy", {}).get("thinking_level"),
        artifact.get("answer_request_policy", {}).get("max_tokens"),
    ) != (300, 300, ANSWER_MODEL, ANSWER_PROMPT_VERSION, ANSWER_THINKING, ANSWER_MAX_TOKENS):
        raise ValueError("Frozen answer contract differs from the pre-registered contract")
    if artifact.get("answer_system_prompt_sha256") != sha256_text(ANSWER_SYSTEM_PROMPT):
        raise ValueError("Answer system prompt hash changed")
    if (
        judge.get("judge_model") != JUDGE_MODEL
        or judge.get("prompt_sha256") != JUDGE_PROMPT_SHA256
    ):
        raise ValueError("Official judge contract changed")

    users = artifact["context_ingestion_users"]
    run_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for row in artifact["data"]:
        key = (users[str(row["context_id"])], row["query"])
        if key in run_by_key:
            raise ValueError("Run join key is not unique")
        run_by_key[key] = row
    wraps_by_id: dict[str, dict[str, Any]] = {}
    with paths["wrap_audit"].open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            wrap = json.loads(line)
            row = run_by_key.get((wrap["userId"], wrap["question"]))
            if row is None:
                raise ValueError("Wrap audit does not join to the frozen run")
            query_id = row["benchmark_query_id"]
            if query_id in wraps_by_id:
                raise ValueError("Multiple final wraps join to one query")
            wraps_by_id[query_id] = wrap
    if len(wraps_by_id) != 299:
        raise ValueError("Expected 299 successful final wraps and one method failure")

    stage_by_id = {row["benchmark_query_id"]: row for row in stage["rows"]}
    targets = sorted(
        query_id
        for query_id, row in stage_by_id.items()
        if row["stage"] == TARGET_STAGE
    )
    guard_population = [
        query_id
        for query_id, row in stage_by_id.items()
        if row["stage"] == GUARD_STAGE
    ]
    guards = sorted(guard_population, key=lambda value: hash_order(GUARD_SEED, value))[
        :GUARD_SIZE
    ]
    if len(targets) != 58 or len(guard_population) != 205 or len(guards) != 40:
        raise ValueError("Gold-conditioned populations changed")
    if set(targets) & set(guards):
        raise ValueError("Failure and guard sets overlap")
    eligible_ids = targets + guards
    if any(query_id not in wraps_by_id for query_id in eligible_ids):
        raise ValueError("An eligible query lacks a successful final wrap")

    all_ids: set[str] = set()
    trace_rows: dict[str, dict[str, Any]] = {}
    passage_span_fields = {"spanStart", "spanEnd", "startOffset", "endOffset", "passageId"}
    source_hash_fields = {"contentHash", "sourceContentHash"}
    passage_span_candidates = 0
    source_hash_candidates = 0
    for query_id in eligible_ids:
        wrap = wraps_by_id[query_id]
        read_ids = [item["memoryId"] for item in wrap["retrieval"]["evidence"]]
        event = successful_first_search(wrap)
        details = event["details"]
        candidates = details.get("candidates", [])
        references = details.get("candidateReferences", [])
        if not 1 <= len(candidates) <= 20:
            raise ValueError("First full-result page is not bounded to 20 candidates")
        if [item["memoryId"] for item in candidates] != [
            item["memoryId"] for item in references
        ]:
            raise ValueError("Candidate references do not preserve display order")
        candidate_ids = [item["memoryId"] for item in candidates]
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("First full-result page contains duplicate parents")
        for candidate in candidates:
            if passage_span_fields & candidate.keys():
                passage_span_candidates += 1
            if source_hash_fields & candidate.keys():
                source_hash_candidates += 1
        all_ids.update(read_ids)
        all_ids.update(candidate_ids)
        trace_rows[query_id] = {
            "wrap": wrap,
            "event": event,
            "candidates": candidates,
            "read_ids": read_ids,
        }

    connection = sqlite3.connect(
        f"file:{paths['database']}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    try:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Immutable SQLite quick_check failed")
        memories = load_rows(connection, all_ids)
    finally:
        connection.close()

    projection_batches: list[dict[str, Any]] = []
    b_extra_by_id: dict[str, list[str]] = {}
    validation_ids_by_id: dict[str, list[str]] = {}
    for query_id in eligible_ids:
        trace = trace_rows[query_id]
        wrap = trace["wrap"]
        read_ids = trace["read_ids"]
        read_set = set(read_ids)
        unread_candidates = [
            candidate
            for candidate in trace["candidates"]
            if candidate["memoryId"] not in read_set
        ]
        capacity = TOTAL_SOURCE_CAP - len(read_ids)
        selected = unread_candidates[: min(EXTRA_PARENT_COUNT, capacity)]
        if len(selected) != EXTRA_PARENT_COUNT:
            raise ValueError("B cannot add four parents within the registered source cap")
        extra_ids = [candidate["memoryId"] for candidate in selected]
        b_extra_by_id[query_id] = extra_ids
        projection_batches.append(
            {
                "batchId": f"b:{query_id}",
                "records": [production_record(memories[value]) for value in extra_ids],
                "focusByMemoryId": {
                    candidate["memoryId"]: candidate_focus(wrap["question"], candidate)
                    for candidate in selected
                },
            }
        )
        audit_candidates = {
            candidate["memoryId"]: candidate
            for candidate in wrap["retrieval"]["audit"]["candidates"]
        }
        validation_ids = [
            value for value in read_ids if value in audit_candidates
        ][:EXTRA_PARENT_COUNT]
        if not validation_ids:
            raise ValueError("No already-read candidate is available for projector validation")
        validation_ids_by_id[query_id] = validation_ids
        projection_batches.append(
            {
                "batchId": f"validation:{query_id}",
                "records": [
                    production_record(memories[value]) for value in validation_ids
                ],
                "focusByMemoryId": {
                    value: candidate_focus(
                        wrap["question"], audit_candidates[value]
                    )
                    for value in validation_ids
                },
            }
        )
    projected = invoke_production_projector(
        helper=projection_helper,
        runtime_source=runtime_source,
        node_container_image=node_container_image,
        batches=projection_batches,
    )
    if projected.get("projector") != "projectMemoryEvidenceBatch":
        raise ValueError("Research helper did not use the registered production projector")
    projected_by_id = {
        batch["batchId"]: batch for batch in projected["batches"]
    }
    if set(projected_by_id) != {batch["batchId"] for batch in projection_batches}:
        raise ValueError("Production projection batch identities are incomplete")

    validation_projected_sources = 0
    validation_projected_truncated = 0
    for query_id, validation_ids in validation_ids_by_id.items():
        evidence = projected_by_id[f"validation:{query_id}"]["evidence"]
        _sources, truncated = verify_projected_evidence(
            evidence, validation_ids, memories
        )
        validation_projected_sources += len(evidence)
        validation_projected_truncated += truncated

    rows: list[dict[str, Any]] = []
    a_sizes: list[int] = []
    b_sizes: list[int] = []
    a_sources: list[int] = []
    b_sources: list[int] = []
    candidate_metadata_checks = 0
    bounded_read_sources = 0
    b_projected_sources = 0
    b_projected_truncated = 0
    group_counts: Counter[str] = Counter()
    target_set = set(targets)
    for query_id in eligible_ids:
        trace = trace_rows[query_id]
        wrap = trace["wrap"]
        run_row = next(
            row for row in artifact["data"] if row["benchmark_query_id"] == query_id
        )
        read_ids, a_prompt_sources, truncated_sources = verify_read_evidence(
            wrap, memories
        )
        bounded_read_sources += truncated_sources
        read_set = set(read_ids)
        candidates = trace["candidates"]
        for candidate in candidates:
            source = memories[candidate["memoryId"]]
            expected = {
                "candidateId": source["memory_id"],
                "memoryId": source["memory_id"],
                "scopeId": source["scope_id"],
                "sessionId": source["session_id"],
                "turnIndex": source["turn_index"],
                "role": source["role"],
                "timestamp": source["timestamp"],
            }
            if any(candidate.get(key) != value for key, value in expected.items()):
                raise ValueError("Trace candidate metadata differs from exact SQLite parent")
            candidate_metadata_checks += 1
        extra_ids = b_extra_by_id[query_id]
        a_prompt = render_prompt(wrap["question"], a_prompt_sources)
        if a_prompt != wrap["prompt"]:
            raise ValueError("Reconstructed A is not byte-identical to saved E0 answer prompt")
        b_ids = read_ids + extra_ids
        projected_evidence = projected_by_id[f"b:{query_id}"]["evidence"]
        b_prompt_sources, b_truncated = verify_projected_evidence(
            projected_evidence, extra_ids, memories
        )
        b_projected_sources += len(projected_evidence)
        b_projected_truncated += b_truncated
        b_prompt = render_prompt(
            wrap["question"],
            a_prompt_sources + b_prompt_sources,
        )
        if "retrieval_summary" in b_prompt or " status=" in b_prompt:
            raise ValueError("B unexpectedly contains summary or status guidance")
        group = (
            "candidate_all_not_read_stage"
            if query_id in target_set
            else "all_gold_read_answer_correct_guard"
        )
        group_counts[group] += 1
        a_bytes = len(a_prompt.encode("utf-8"))
        b_bytes = len(b_prompt.encode("utf-8"))
        a_sizes.append(a_bytes)
        b_sizes.append(b_bytes)
        a_sources.append(len(read_ids))
        b_sources.append(len(b_ids))
        rows.append(
            {
                "benchmark_query_id": query_id,
                "group": group,
                "current_judge_correct": bool(stage_by_id[query_id]["correct"]),
                "question_type": run_row["question_type"],
                "first_search_trace_step": trace["event"]["step"],
                "first_search_full_page_count": len(candidates),
                "current_read_memory_ids": read_ids,
                "b_added_memory_ids": extra_ids,
                "a_source_count": len(read_ids),
                "b_source_count": len(b_ids),
                "a_prompt": a_prompt,
                "b_prompt": b_prompt,
                "a_prompt_sha256": sha256_text(a_prompt),
                "b_prompt_sha256": sha256_text(b_prompt),
                "a_prompt_utf8_bytes": a_bytes,
                "b_prompt_utf8_bytes": b_bytes,
                "b_added_exact_parent_sha256": [
                    sha256_text(memories[value]["content"]) for value in extra_ids
                ],
                "b_projected_evidence": projected_evidence,
            }
        )
    rows.sort(key=lambda row: row["benchmark_query_id"])

    pair_order = sorted(
        [row["benchmark_query_id"] for row in rows],
        key=lambda value: hash_order(SCHEDULE_SEED + "|pair", value),
    )
    schedule: list[dict[str, Any]] = []
    for pair_index, query_id in enumerate(pair_order):
        arm_digest = sha256_text(f"{SCHEDULE_SEED}|arm\0{query_id}")
        arms = ["a_current_exact_read", "b_current_plus_top4_unread_parent"]
        if int(arm_digest[:2], 16) % 2:
            arms.reverse()
        for arm in arms:
            schedule.append(
                {
                    "schedule_index": len(schedule),
                    "pair_index": pair_index,
                    "benchmark_query_id": query_id,
                    "arm": arm,
                }
            )

    preparation = {
        "schema_version": 1,
        "status": "prepared_no_model_calls",
        "experiment": EXPERIMENT,
        "claim_boundary": {
            "formal_end_to_end_score": False,
            "eligibility_uses_gold": True,
            "evidence_selection_uses_gold": False,
            "scope": (
                "fixed-trace diagnostic on all 58 candidate-all-not-read stage rows and "
                "40 pre-hash-sampled all-gold-read-correct guards; never extrapolate "
                "the result to the full 300"
            ),
        },
        "arms": {
            "a_current_exact_read": (
                "saved E0 exact read package, reconstructed byte-for-byte from immutable SQLite"
            ),
            "b_current_plus_top4_unread_parent": (
                "A, then frozen production projectMemoryEvidenceBatch outputs for the "
                "first four unread parents in first successful search's full-page "
                "display order; focus is only the original question plus trace "
                "candidate discovery queries; no gold, score threshold, or question type"
            ),
            "ordering": "current read order followed by full-page display order",
            "deduplication": "stable memory_id against A and within the full page",
            "extra_parent_count": EXTRA_PARENT_COUNT,
            "total_source_cap": TOTAL_SOURCE_CAP,
        },
        "selection": {
            "candidate_stage": TARGET_STAGE,
            "candidate_stage_count": len(targets),
            "candidate_stage_ids": targets,
            "candidate_stage_ids_sha256": ordered_ids_sha256(targets),
            "candidate_stage_current_judge_strata": {
                "correct": sum(bool(stage_by_id[value]["correct"]) for value in targets),
                "incorrect": sum(not bool(stage_by_id[value]["correct"]) for value in targets),
            },
            "guard_population_stage": GUARD_STAGE,
            "guard_population_count": len(guard_population),
            "guard_sample_count": len(guards),
            "guard_hash_seed": GUARD_SEED,
            "guard_hash_rule": "ascending sha256(seed + NUL + benchmark_query_id)",
            "guard_ids": guards,
            "guard_ids_sha256": ordered_ids_sha256(guards),
            "guard_current_judge_strata": {
                "correct": sum(bool(stage_by_id[value]["correct"]) for value in guards),
                "incorrect": sum(not bool(stage_by_id[value]["correct"]) for value in guards),
            },
            "eligible_ids_sha256": ordered_ids_sha256(targets + guards),
            "wrong_only_filter_applied": False,
        },
        "schedule": {
            "seed": SCHEDULE_SEED,
            "rule": "hash-shuffled question pairs; arm order independently hash-randomized within pair",
            "fresh_answers": True,
            "fresh_judges": True,
            "units": schedule,
        },
        "answer_contract": {
            "model": ANSWER_MODEL,
            "thinking_level": ANSWER_THINKING,
            "max_completion_tokens": ANSWER_MAX_TOKENS,
            "system_prompt": ANSWER_SYSTEM_PROMPT,
            "system_prompt_sha256": sha256_text(ANSWER_SYSTEM_PROMPT),
            "answer_prompt_version": ANSWER_PROMPT_VERSION,
            "same_task_prompt": True,
            "summary_and_status_omitted": True,
        },
        "judge_contract": {
            "model": JUDGE_MODEL,
            "official_prompt_source_commit": judge["official_prompt_source_commit"],
            "official_prompt_sha256": JUDGE_PROMPT_SHA256,
            "fresh_per_arm": True,
        },
        "source_hashes": {
            name: {"path": str(locked_paths[name].resolve()), "sha256": digest}
            for name, digest in source_hashes.items()
        },
        "integrity": {
            "final_wraps": len(wraps_by_id),
            "method_failure_without_wrap": 1,
            "eligible_rows": len(rows),
            "candidate_stage_rows": group_counts["candidate_all_not_read_stage"],
            "guard_rows": group_counts["all_gold_read_answer_correct_guard"],
            "a_prompt_byte_exact_checks": len(rows),
            "candidate_metadata_to_sqlite_checks": candidate_metadata_checks,
            "candidate_passage_span_fields_present": passage_span_candidates,
            "candidate_source_hash_fields_present": source_hash_candidates,
            "candidate_reconstruction_level": "exact_parent_not_passage",
            "bounded_exact_read_sources_in_a": bounded_read_sources,
            "production_projector": projected["projector"],
            "production_projector_module": projected["runtimeModule"],
            "node_runtime": {
                "version": projected["nodeVersion"],
                "container_image": node_container_image,
                "container_image_id": node_image_id,
                "role": "execution engine only; method code is imported from the frozen runtime source",
            },
            "production_read_budget_chars": projected["maxReadResultChars"],
            "b_projection_batches": len(rows),
            "b_projected_sources": b_projected_sources,
            "b_projected_truncated_sources": b_projected_truncated,
            "b_projected_truncation_rate": (
                b_projected_truncated / b_projected_sources
            ),
            "already_read_validation_batches": len(validation_ids_by_id),
            "already_read_validation_sources": validation_projected_sources,
            "already_read_validation_truncated_sources": validation_projected_truncated,
            "already_read_validation_invariants": (
                "same frozen projectMemoryEvidenceBatch path; source identity/hash/UTF-16 "
                "spans/content hash/production renderer/read budget all verified; equality "
                "with the Agent's historical batch is intentionally not required"
            ),
            "sqlite_mode": "ro,immutable=1",
            "sqlite_quick_check": "ok",
        },
        "prompt_sizes_utf8_bytes": {
            "a": size_summary(a_sizes),
            "b": size_summary(b_sizes),
            "b_minus_a": size_summary(
                [right - left for left, right in zip(a_sizes, b_sizes)]
            ),
        },
        "source_counts": {
            "a": size_summary(a_sources),
            "b": size_summary(b_sources),
        },
        "cost_plan": {
            "paired_questions": len(rows),
            "fresh_answer_calls": len(rows) * 2,
            "fresh_judge_calls": len(rows) * 2,
            "total_model_calls": len(rows) * 4,
            "answer_input_utf8_bytes": sum(a_sizes) + sum(b_sizes),
            "rough_answer_input_token_proxy_utf8_bytes_div_4": (
                (sum(a_sizes) + sum(b_sizes)) / 4
            ),
            "note": "No price estimate is asserted because the provider price is not part of the frozen run contract.",
        },
        "analysis_plan": {
            "primary": [
                "candidate-all-not-read stage paired A/B flips and exact two-sided McNemar test",
                "guard subset paired A/B flips and exact two-sided McNemar test",
                "pre-registered descriptive candidate-stage strata by current judge correct/incorrect; never used to select B evidence",
            ],
            "do_not_pool_as_full300": True,
            "report_by_question_type": "descriptive only; no benchmark-specific tuning",
        },
        "risks": [
            "Eligibility is gold-conditioned, so results are diagnostic and not an online score.",
            "The audit has stable parent IDs and metadata but no passage byte spans or candidate source hashes; B projects exact parents through the frozen production evidence projector and does not claim passage reconstruction.",
            "Eligibility means the full frozen trace candidate pool covered all mapped gold groups; B deliberately uses only first-search top-4 unread parents and is not guaranteed to add a missing gold source.",
            "B changes both automatic inspect selection and context size; irrelevant top-ranked parents may add answer noise.",
            "The 40 guards are a pre-hash sample of an already-successful gold-conditioned population, not a representative sample of all 300 questions.",
            "Fresh paired calls remain stochastic; within-pair arm randomization reduces, but does not remove, provider drift.",
        ],
        "rows": rows,
    }
    preparation_path = output / "preparation" / "eligibility-and-prompts.json"
    write_json(preparation_path, preparation)
    manifest = {
        "schema_version": 1,
        "status": "PREPARED_AWAITING_APPROVAL_NO_MODEL_CALLS",
        "experiment": EXPERIMENT,
        "preparation": str(preparation_path.resolve()),
        "preparation_sha256": sha256_file(preparation_path),
        "candidate_stage_questions": len(targets),
        "candidate_stage_ids_sha256": ordered_ids_sha256(targets),
        "candidate_stage_current_correct": sum(
            bool(stage_by_id[value]["correct"]) for value in targets
        ),
        "candidate_stage_current_incorrect": sum(
            not bool(stage_by_id[value]["correct"]) for value in targets
        ),
        "guard_questions": len(guards),
        "paired_questions": len(rows),
        "fresh_answer_calls_if_approved": len(rows) * 2,
        "fresh_judge_calls_if_approved": len(rows) * 2,
        "a_prompt_byte_exact_checks": len(rows),
        "b_max_prompt_utf8_bytes": max(b_sizes),
        "exact_candidate_level": "production_projection_of_exact_parent",
        "passage_span_or_hash_available": False,
        "source_hashes": preparation["source_hashes"],
    }
    manifest_path = output / "PREPARATION_MANIFEST.json"
    write_json(manifest_path, manifest)
    checksums_path = output / "PREPARATION_SHA256SUMS"
    checksums_path.write_text(
        "".join(
            f"{sha256_file(path)}  {path.resolve()}\n"
            for path in (
                Path(__file__).resolve(),
                projection_helper,
                projector_module,
                preparation_path,
                manifest_path,
            )
        ),
        encoding="utf-8",
    )
    os.chmod(checksums_path, 0o600)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-source", type=Path, required=True)
    parser.add_argument("--projection-helper", type=Path, required=True)
    parser.add_argument("--node-container-image", required=True)
    args = parser.parse_args()
    manifest = prepare(
        args.root.resolve(),
        args.output.resolve(),
        args.runtime_source.resolve(),
        args.projection_helper.resolve(),
        args.node_container_image,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
