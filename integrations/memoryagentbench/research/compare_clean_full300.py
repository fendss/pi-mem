#!/usr/bin/env python3
"""Prepare and run a clean, paired LongMemEval-S full-300 comparison.

Preparation mode validates the completed inline-compose and historical GPT-4o
artifacts and writes an immutable input manifest.  It deliberately accepts no
final-run paths, so it cannot inspect an experiment that is still running.

Comparison mode additionally requires a complete final run, its official
GPT-4o judge, and a cleaned one-row-per-question wrap audit.  Requiring 300
fresh wrap rows is the guard against accidentally comparing a mixed resume-seed
artifact whose apparent 300 rows contain copied controls.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any


EVAL_ROOT = Path(os.environ.get("PIMEM_EVAL_ROOT", "artifacts"))
INLINE_ROOT = EVAL_ROOT / "memoryagentbench-lme-inline-compose-v2-20260830"
ORACLE_ROOT = EVAL_ROOT / "memoryagentbench-lme-oracle-ablation-20260830"
HISTORICAL_ROOT = EVAL_ROOT / (
    "refind-protocol-20260824/"
    "full-native-observation-v5-lme-s500-budget4-composite-s128-run1/"
    "evaluation/current-gpt4o-mab300-rejudge"
)

DEFAULT_INLINE_RUN = INLINE_ROOT / "runs/inline-compose-v2/longmemeval-s-static.json"
DEFAULT_INLINE_JUDGE = INLINE_ROOT / "evaluation/gpt4o-official/longmemeval-s-static.json"
DEFAULT_INLINE_AUDIT = ORACLE_ROOT / "inline-compose-v2-wrap-audits.clean.jsonl"
DEFAULT_INLINE_AUDIT_MANIFEST = (
    ORACLE_ROOT / "inline-compose-v2-wrap-audits.clean.manifest.json"
)
DEFAULT_DIAGNOSTIC = ORACLE_ROOT / "pipeline-diagnostic.inline-compose-v2.clean.json"
DEFAULT_HISTORICAL_RUN = HISTORICAL_ROOT / "input/longmemeval-s-static.json"
DEFAULT_HISTORICAL_JUDGE = HISTORICAL_ROOT / "output/longmemeval-s-static.json"
DEFAULT_HISTORICAL_GENERATION_AUDIT = EVAL_ROOT / (
    "lme300-clean-final-comparison-20260831/"
    "preparation/historical-best-vs-canonical-mab300-question-date-manifest.json"
)

EXPECTED_SHA256 = {
    "inline_run": "cea2d7e8ca714e93540fd4cab8249f597335690dcbdc23dc197af014baa66da6",
    "inline_judge": "f9c08c8e7acbce89c08341177daf0c1deabfd35b76bc490aaf7a1c953fb5af82",
    "inline_audit": "205c5b5eaf60a5fefe23e761aa218405ec264d318d3a06c3c40024f1b90cb99f",
    "inline_audit_manifest": "612c36f9010760fd68a4e49c251fc8ca1d6f029c61ab398fdf53f100fe446784",
    "diagnostic": "4224e6c91ef0621404b9a53964cfcd8f3945d74da06c5f25d741321e57f52a51",
    "historical_run": "535e2bc9d73fc03d7281df42db0372bb26b8c06570def88b4ff3e08e81636df1",
    "historical_judge": "47add711f49c1036b5edb1c07490bdc00b6a30859756634d11f3714a10ae0b4b",
    "historical_generation_audit": "6df75cbc401b233da29b26d8c29c8d744a041c2e6948f2155c47dd88e4a9f77e",
}

EXPECTED_JUDGE = {
    "judge_model": "gpt-4o",
    "official_prompt_source_commit": "fe1735de8cf8b9908e1e3d3b5612afc815698062",
    "prompt_sha256": "2c90b57efc5142071e32e10b3b131bbad6ee37626b6287d007ab1f52a2cdf54d",
    "mode": "static",
    "response_model": "gpt-4o-2024-08-06",
}

SOURCE_FIELDS = (
    "context_id",
    "qa_pair_id",
    "question_id",
    "question_type",
    "query",
    "answer",
)

RUN_CONTRACT_FIELDS = (
    "benchmark",
    "task",
    "capability",
    "source",
    "official_config",
    "query_template_sha256",
    "benchmark_commit",
    "dataset_revision",
)

COST_FIELDS = (
    "query_time_seconds",
    "search_calls",
    "read_calls",
    "candidate_count",
    "inspected_evidence_count",
    "evidence_count",
    "cited_count",
    "retrieval_input_tokens",
    "retrieval_output_tokens",
    "retrieval_reasoning_tokens",
    "retrieval_total_tokens",
    "retrieval_cache_read_tokens",
    "embedding_calls",
    "embedding_latency_ms",
    "trace_search_calls",
    "trace_search_more_calls",
    "trace_read_calls",
    "trace_error_calls",
    "full_candidate_references_shown",
    "directory_candidate_references_shown",
    "physical_reservoir_candidates",
)

DIRECTORY_FLAGS = (
    "initial_directory_exposed",
    "initial_directory_read",
    "initial_directory_committed",
    "initial_directory_has_gold",
    "initial_directory_gold_read",
    "initial_directory_gold_committed",
    "directory_origin_exposed",
    "directory_origin_read",
    "directory_origin_committed",
    "directory_origin_has_gold",
    "directory_origin_gold_read",
    "directory_origin_gold_committed",
    "trace_linked_directory_gold_commit",
    "trace_linked_directory_gold_commit_and_correct",
)


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number} must be a JSON object")
            result.append(value)
    return result


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def rows_by_id(
    rows: Iterable[dict[str, Any]], key: str, source: Path
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"{source}: row has no non-empty {key}")
        if value in result:
            raise ValueError(f"{source}: duplicate {key} {value!r}")
        result[value] = row
    return result


def wrap_query_id(row: dict[str, Any]) -> str | None:
    for value in (
        row.get("operatorExperiment"),
        (row.get("retrieval") or {}).get("operatorExperiment"),
    ):
        if isinstance(value, dict) and isinstance(value.get("questionId"), str):
            return value["questionId"]
    return None


def wrap_rows_by_id(rows: Iterable[dict[str, Any]], source: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        query_id = wrap_query_id(row)
        if not query_id:
            raise ValueError(f"{source}: wrap row has no operator questionId")
        if query_id in result:
            raise ValueError(
                f"{source}: duplicate wrap row {query_id!r}; provide a clean "
                "one-final-attempt-per-question audit"
            )
        result[query_id] = row
    return result


def validate_exact_ids(
    label: str, rows: dict[str, Any], expected: set[str], expected_count: int
) -> None:
    actual = set(rows)
    if len(actual) != expected_count or actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(
            f"{label}: expected exactly {expected_count} canonical IDs; "
            f"missing={missing[:5]}, extra={extra[:5]}"
        )


def validate_sha(label: str, path: Path, expected: str | None) -> str:
    actual = sha256(path)
    if expected and actual != expected:
        raise ValueError(f"{label}: SHA-256 {actual} != frozen {expected}")
    return actual


def validate_judge(
    label: str,
    judge_path: Path,
    judge: dict[str, Any],
    run_path: Path,
    run_rows: dict[str, dict[str, Any]],
    expected_ids: set[str],
    expected_count: int,
) -> dict[str, dict[str, Any]]:
    for field in ("judge_model", "official_prompt_source_commit", "prompt_sha256", "mode"):
        if judge.get(field) != EXPECTED_JUDGE[field]:
            raise ValueError(
                f"{label}: judge {field}={judge.get(field)!r}, "
                f"expected {EXPECTED_JUDGE[field]!r}"
            )
    source = judge.get("source_artifact")
    if not isinstance(source, str) or Path(source).resolve() != run_path.resolve():
        raise ValueError(
            f"{label}: source_artifact {source!r} does not identify {run_path}"
        )
    rows = rows_by_id(judge.get("data") or [], "benchmark_query_id", judge_path)
    validate_exact_ids(f"{label} judge", rows, expected_ids, expected_count)
    response_models: set[str] = set()
    for query_id, row in rows.items():
        run_row = run_rows[query_id]
        if row.get("question_id") != run_row.get("question_id"):
            raise ValueError(f"{label}: question_id mismatch for {query_id}")
        if row.get("question_type") != run_row.get("question_type"):
            raise ValueError(f"{label}: question_type mismatch for {query_id}")
        if not isinstance(row.get("label"), bool):
            raise ValueError(f"{label}: non-boolean judge label for {query_id}")
        response_model = row.get("response_model")
        if isinstance(response_model, str):
            response_models.add(response_model)
    if response_models != {EXPECTED_JUDGE["response_model"]}:
        raise ValueError(
            f"{label}: response models {sorted(response_models)} do not match "
            f"{EXPECTED_JUDGE['response_model']}"
        )
    return rows


def validate_source_rows(
    label: str,
    rows: dict[str, dict[str, Any]],
    canonical_rows: dict[str, dict[str, Any]],
) -> None:
    for query_id, row in rows.items():
        reference = canonical_rows[query_id]
        for field in SOURCE_FIELDS:
            if canonical(row.get(field)) != canonical(reference.get(field)):
                raise ValueError(
                    f"{label}: source field {field!r} differs for {query_id}"
                )


def validate_run_contract(
    label: str, run: dict[str, Any], canonical_run: dict[str, Any]
) -> None:
    for field in RUN_CONTRACT_FIELDS:
        if canonical(run.get(field)) != canonical(canonical_run.get(field)):
            raise ValueError(f"{label}: run contract field {field!r} differs")


def validate_final_memory_identity(
    final_run: dict[str, Any], inline_run: dict[str, Any]
) -> None:
    for field in ("ingestion_strategy", "memorize_template_sha256"):
        if canonical(final_run.get(field)) != canonical(inline_run.get(field)):
            raise ValueError(
                f"final: memory identity field {field!r} differs from inline"
            )
    final_reuse = final_run.get("ingestion_reuse") or {}
    inline_reuse = inline_run.get("ingestion_reuse") or {}
    if not isinstance(final_reuse, dict) or not isinstance(inline_reuse, dict):
        raise ValueError("final/inline ingestion_reuse must be objects")
    if final_reuse.get("sha256") != inline_reuse.get("sha256"):
        raise ValueError(
            "final ingestion seed SHA differs from inline; gold memory IDs are "
            "not guaranteed comparable"
        )


def validate_final_model_contract(
    final_run: dict[str, Any],
    inline_run: dict[str, Any],
    final_rows: dict[str, dict[str, Any]],
    inline_rows: dict[str, dict[str, Any]],
) -> None:
    for field in ("answer_model", "answer_request_policy"):
        if canonical(final_run.get(field)) != canonical(inline_run.get(field)):
            raise ValueError(f"final: model contract field {field!r} differs")
    for field in ("mode", "max_search_calls", "state_boundary"):
        final_value = (final_run.get("operator_experiment") or {}).get(field)
        inline_value = (inline_run.get("operator_experiment") or {}).get(field)
        if canonical(final_value) != canonical(inline_value):
            raise ValueError(f"final: operator contract field {field!r} differs")
    retrieval_fields = ("providerId", "modelId", "thinkingLevel", "transport")
    for query_id, final_row in final_rows.items():
        inline_row = inline_rows[query_id]
        for field in retrieval_fields:
            final_value = (final_row.get("retrieval_model") or {}).get(field)
            inline_value = (inline_row.get("retrieval_model") or {}).get(field)
            if final_value != inline_value:
                raise ValueError(
                    f"final: retrieval model field {field!r} differs for {query_id}"
                )


def sorted_id_list_sha(query_ids: Iterable[str]) -> str:
    payload = ("\n".join(sorted(query_ids)) + "\n").encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def canonical_rows_sha(
    rows: dict[str, dict[str, Any]], fields: tuple[str, ...]
) -> str:
    digest = hashlib.sha256()
    for query_id in sorted(rows):
        value = {field: rows[query_id].get(field) for field in fields}
        digest.update(canonical(value).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def numeric(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return default


def trace_summary(wrap: dict[str, Any]) -> dict[str, float]:
    trace = (wrap.get("retrieval") or {}).get("trace") or []
    if not isinstance(trace, list):
        trace = []
    tool_counts: Counter[str] = Counter()
    errors = 0
    full_memories: set[str] = set()
    directory_memories: set[str] = set()
    reservoir_total = 0.0
    for call in trace:
        if not isinstance(call, dict):
            continue
        tool = str(call.get("toolName") or "unknown")
        tool_counts[tool] += 1
        if call.get("isError") is True:
            errors += 1
            continue
        if tool not in {"search", "search_more"}:
            continue
        details = call.get("details") or {}
        if not isinstance(details, dict):
            continue
        for field, sink in (
            ("candidateReferences", full_memories),
            ("directoryCandidateReferences", directory_memories),
        ):
            for item in details.get(field) or []:
                if not isinstance(item, dict):
                    continue
                memory_id = item.get("memoryId") or item.get("candidateId")
                if isinstance(memory_id, str):
                    sink.add(memory_id)
        physical = details.get("physicalPlan") or {}
        if isinstance(physical, dict):
            reservoir_total += numeric(physical.get("candidateReservoirCount"))
    return {
        "trace_search_calls": float(tool_counts["search"]),
        "trace_search_more_calls": float(tool_counts["search_more"]),
        "trace_read_calls": float(tool_counts["read"]),
        "trace_error_calls": float(errors),
        "full_candidate_references_shown": float(len(full_memories)),
        "directory_candidate_references_shown": float(len(directory_memories)),
        "physical_reservoir_candidates": reservoir_total,
    }


def cost_record(run_row: dict[str, Any], wrap: dict[str, Any]) -> dict[str, float]:
    retrieval = wrap.get("retrieval") or {}
    usage = retrieval.get("usage") or {}
    audit = retrieval.get("audit") or {}
    metrics = audit.get("metrics") or {}
    operator = run_row.get("operator_experiment") or {}
    result = {
        "query_time_seconds": numeric(run_row.get("query_time_seconds")),
        "search_calls": numeric(metrics.get("searchCalls", operator.get("searchCalls"))),
        "read_calls": numeric(metrics.get("readCalls")),
        "candidate_count": numeric(metrics.get("candidateCount")),
        "inspected_evidence_count": numeric(metrics.get("inspectedEvidenceCount")),
        "evidence_count": numeric(metrics.get("evidenceCount")),
        "cited_count": numeric(metrics.get("citedCount")),
        "retrieval_input_tokens": numeric(usage.get("input")),
        "retrieval_output_tokens": numeric(usage.get("output")),
        "retrieval_reasoning_tokens": numeric(usage.get("reasoning")),
        "retrieval_total_tokens": numeric(usage.get("totalTokens")),
        "retrieval_cache_read_tokens": numeric(usage.get("cacheRead")),
        "embedding_calls": numeric(metrics.get("embeddingCalls")),
        "embedding_latency_ms": numeric(metrics.get("embeddingLatencyMs")),
    }
    result.update(trace_summary(wrap))
    return result


def percentile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def summarize_costs(rows: list[dict[str, float]]) -> dict[str, Any]:
    result: dict[str, Any] = {"count": len(rows)}
    for field in COST_FIELDS:
        values = [numeric(row.get(field)) for row in rows]
        result[field] = {
            "total": sum(values),
            "mean": statistics.fmean(values) if values else None,
            "median": statistics.median(values) if values else None,
            "p90": percentile(values, 0.9),
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    return result


def reference_map(value: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, dict):
            continue
        candidate_ref = item.get("candidateRef")
        memory_id = item.get("memoryId") or item.get("candidateId")
        if isinstance(candidate_ref, str) and isinstance(memory_id, str):
            result[candidate_ref] = memory_id
    return result


def visible_candidate_ids(wrap: dict[str, Any]) -> set[str]:
    """Mirror the frozen diagnostic and add model-visible directory entries."""
    result: set[str] = set()
    trace = (wrap.get("retrieval") or {}).get("trace") or []
    if not isinstance(trace, list):
        return result
    for call in trace:
        if not isinstance(call, dict):
            continue
        details = call.get("details") or {}
        if not isinstance(details, dict):
            continue
        for field in ("candidates", "directoryCandidates"):
            for candidate in details.get(field) or []:
                if not isinstance(candidate, dict):
                    continue
                memory_id = candidate.get("memoryId") or candidate.get("candidateId")
                if isinstance(memory_id, str):
                    result.add(memory_id)
    return result


def coverage(groups: list[set[str]], observed: set[str]) -> tuple[bool, bool]:
    if not groups:
        return False, False
    matches = [bool(group & observed) for group in groups]
    return any(matches), all(matches)


def final_pipeline_record(
    wrap: dict[str, Any], diagnostic: dict[str, Any], correct: bool
) -> dict[str, Any]:
    groups = [
        {memory_id for memory_id in group if isinstance(memory_id, str)}
        for group in (diagnostic.get("gold_source_groups") or [])
        if isinstance(group, list)
    ]
    candidates = visible_candidate_ids(wrap)
    selected = {
        memory_id
        for memory_id in (wrap.get("selectedMemoryIds") or [])
        if isinstance(memory_id, str)
    }
    candidate_any, candidate_all = coverage(groups, candidates)
    selected_any, selected_all = coverage(groups, selected)
    if not groups:
        stage = "unresolved_gold_mapping"
    elif not candidate_any:
        stage = "no_gold_candidate"
    elif not candidate_all:
        stage = "partial_gold_candidates"
    elif not selected_all:
        stage = "candidate_not_committed"
    elif not correct:
        stage = "gold_committed_answer_wrong"
    else:
        stage = "gold_committed_answer_correct"
    return {
        "stage": stage,
        "candidate_gold_any": candidate_any,
        "candidate_gold_all": candidate_all,
        "selected_gold_any": selected_any,
        "selected_gold_all": selected_all,
        "candidate_count": len(candidates),
        "selected_count": len(selected),
    }


def read_refs(call: dict[str, Any]) -> set[str]:
    arguments = call.get("arguments") or call.get("args") or {}
    if not isinstance(arguments, dict) or not isinstance(arguments.get("candidateRefs"), list):
        return set()
    return {value for value in arguments["candidateRefs"] if isinstance(value, str)}


def directory_record(
    wrap: dict[str, Any], diagnostic: dict[str, Any], correct: bool
) -> dict[str, Any]:
    trace = (wrap.get("retrieval") or {}).get("trace") or []
    if not isinstance(trace, list):
        trace = []
    presentation_calls = [
        call
        for call in trace
        if isinstance(call, dict)
        and call.get("toolName") in {"search", "search_more"}
        and call.get("isError") is not True
    ]
    semantic_searches = [
        call for call in presentation_calls if call.get("toolName") == "search"
    ]
    initial_full: dict[str, str] = {}
    initial_directory: dict[str, str] = {}
    if semantic_searches:
        details = semantic_searches[0].get("details") or {}
        if isinstance(details, dict):
            initial_full = reference_map(details.get("candidateReferences"))
            initial_directory = reference_map(
                details.get("directoryCandidateReferences")
            )

    origin: dict[str, tuple[str, str]] = {}
    for call in presentation_calls:
        details = call.get("details") or {}
        if not isinstance(details, dict):
            continue
        for candidate_ref, memory_id in reference_map(
            details.get("candidateReferences")
        ).items():
            origin.setdefault(candidate_ref, ("full", memory_id))
        for candidate_ref, memory_id in reference_map(
            details.get("directoryCandidateReferences")
        ).items():
            origin.setdefault(candidate_ref, ("directory", memory_id))

    directly_read_refs: set[str] = set()
    for call in trace:
        if (
            isinstance(call, dict)
            and call.get("toolName") == "read"
            and call.get("isError") is not True
        ):
            directly_read_refs.update(read_refs(call))
    selected = {
        value
        for value in (wrap.get("selectedMemoryIds") or [])
        if isinstance(value, str)
    }
    gold_groups = [
        {memory_id for memory_id in group if isinstance(memory_id, str)}
        for group in (diagnostic.get("gold_source_groups") or [])
        if isinstance(group, list)
    ]
    all_gold = set().union(*gold_groups) if gold_groups else set()

    initial_directory_memories = set(initial_directory.values())
    initial_directory_read_memories = {
        initial_directory[candidate_ref]
        for candidate_ref in directly_read_refs & set(initial_directory)
    }
    directory_origin_refs = {
        candidate_ref
        for candidate_ref, (kind, _) in origin.items()
        if kind == "directory"
    }
    directory_origin_memories = {
        memory_id for kind, memory_id in origin.values() if kind == "directory"
    }
    directory_origin_read_memories = {
        origin[candidate_ref][1]
        for candidate_ref in directly_read_refs & directory_origin_refs
    }
    trace_linked_gold = (
        directory_origin_read_memories & selected & all_gold
    )

    def hit_groups(memory_ids: set[str]) -> int:
        return sum(bool(memory_ids & group) for group in gold_groups)

    return {
        "initial_full_count": len(initial_full),
        "initial_directory_count": len(initial_directory),
        "initial_directory_exposed": bool(initial_directory),
        "initial_directory_read": bool(initial_directory_read_memories),
        "initial_directory_committed": bool(selected & initial_directory_memories),
        "initial_directory_has_gold": bool(initial_directory_memories & all_gold),
        "initial_directory_gold_read": bool(initial_directory_read_memories & all_gold),
        "initial_directory_gold_committed": bool(selected & initial_directory_memories & all_gold),
        "directory_origin_count": len(directory_origin_memories),
        "directory_origin_exposed": bool(directory_origin_memories),
        "directory_origin_read": bool(directory_origin_read_memories),
        "directory_origin_committed": bool(selected & directory_origin_memories),
        "directory_origin_has_gold": bool(directory_origin_memories & all_gold),
        "directory_origin_gold_read": bool(directory_origin_read_memories & all_gold),
        "directory_origin_gold_committed": bool(selected & directory_origin_memories & all_gold),
        "trace_linked_directory_gold_commit": bool(trace_linked_gold),
        "trace_linked_directory_gold_commit_and_correct": bool(trace_linked_gold) and correct,
        "gold_group_count": len(gold_groups),
        "directory_origin_gold_group_count": hit_groups(directory_origin_memories),
        "directory_origin_gold_read_group_count": hit_groups(directory_origin_read_memories),
        "trace_linked_directory_gold_commit_group_count": hit_groups(trace_linked_gold),
    }


def exact_mcnemar_p(final_only: int, comparator_only: int) -> float:
    discordant = final_only + comparator_only
    if discordant == 0:
        return 1.0
    tail = min(final_only, comparator_only)
    probability = sum(math.comb(discordant, k) for k in range(tail + 1)) / (
        2**discordant
    )
    return min(1.0, 2 * probability)


def accuracy(rows: list[dict[str, Any]], version: str) -> dict[str, Any]:
    correct = sum(bool(row["correct"][version]) for row in rows)
    return {
        "count": len(rows),
        "correct": correct,
        "accuracy": correct / len(rows) if rows else None,
    }


def paired(rows: list[dict[str, Any]], comparator: str) -> dict[str, Any]:
    both = sum(row["correct"]["final"] and row["correct"][comparator] for row in rows)
    final_only = sum(
        row["correct"]["final"] and not row["correct"][comparator] for row in rows
    )
    comparator_only = sum(
        not row["correct"]["final"] and row["correct"][comparator] for row in rows
    )
    both_wrong = len(rows) - both - final_only - comparator_only
    return {
        "comparator": comparator,
        "count": len(rows),
        "both_correct": both,
        "final_only_correct": final_only,
        "comparator_only_correct": comparator_only,
        "both_wrong": both_wrong,
        "accuracy_delta": (final_only - comparator_only) / len(rows),
        "mcnemar_exact_two_sided_p": exact_mcnemar_p(final_only, comparator_only),
        "final_only_ids": sorted(
            row["benchmark_query_id"]
            for row in rows
            if row["correct"]["final"] and not row["correct"][comparator]
        ),
        "comparator_only_ids": sorted(
            row["benchmark_query_id"]
            for row in rows
            if not row["correct"]["final"] and row["correct"][comparator]
        ),
    }


def accuracy_breakdown(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    groups: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row[field])].append(row)
    result = []
    for group_name in sorted(groups):
        group = groups[group_name]
        result.append(
            {
                "group": group_name,
                "count": len(group),
                **{version: accuracy(group, version) for version in ("historical", "inline", "final")},
            }
        )
    return result


def directory_counts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {"count": len(rows)}
    for flag in DIRECTORY_FLAGS:
        result[flag] = sum(bool(row["directory"][flag]) for row in rows)
    result["directory_origin_gold_groups_total"] = sum(
        row["directory"]["directory_origin_gold_group_count"] for row in rows
    )
    result["directory_origin_gold_read_groups_total"] = sum(
        row["directory"]["directory_origin_gold_read_group_count"] for row in rows
    )
    result["trace_linked_directory_gold_commit_groups_total"] = sum(
        row["directory"]["trace_linked_directory_gold_commit_group_count"]
        for row in rows
    )
    return result


def directory_breakdown(
    rows: list[dict[str, Any]], field: str
) -> list[dict[str, Any]]:
    groups: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row[field])].append(row)
    return [
        {"group": name, **directory_counts(groups[name])} for name in sorted(groups)
    ]


def stage_transitions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: defaultdict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[(str(row["inline_pipeline_stage"]), str(row["final_pipeline_stage"]))].append(row)
    result = []
    for (inline_stage, final_stage), group in sorted(groups.items()):
        result.append(
            {
                "inline_stage": inline_stage,
                "final_stage": final_stage,
                "count": len(group),
                "inline_correct": sum(row["correct"]["inline"] for row in group),
                "final_correct": sum(row["correct"]["final"] for row in group),
            }
        )
    return result


def artifact_entry(path: Path, expected_sha: str | None = None) -> dict[str, Any]:
    return {"path": str(path), "sha256": validate_sha(str(path), path, expected_sha)}


def load_baselines(args: argparse.Namespace) -> dict[str, Any]:
    inline_run = read_json(args.inline_run)
    inline_rows = rows_by_id(
        inline_run.get("data") or [], "benchmark_query_id", args.inline_run
    )
    if len(inline_rows) != args.expected_count:
        raise ValueError(
            f"inline run has {len(inline_rows)} rows, expected {args.expected_count}"
        )
    canonical_ids = set(inline_rows)
    if inline_run.get("completed_queries") != args.expected_count:
        raise ValueError("inline run is not complete")
    if inline_run.get("failures") or inline_run.get("retryable_failures"):
        raise ValueError("inline run has unresolved failures")

    inline_judge = read_json(args.inline_judge)
    inline_judge_rows = validate_judge(
        "inline",
        args.inline_judge,
        inline_judge,
        args.inline_run,
        inline_rows,
        canonical_ids,
        args.expected_count,
    )
    inline_correct = sum(bool(row["label"]) for row in inline_judge_rows.values())
    if inline_correct != args.expected_inline_correct:
        raise ValueError(
            f"inline correct={inline_correct}, expected {args.expected_inline_correct}"
        )

    inline_wrap = wrap_rows_by_id(read_jsonl(args.inline_audit), args.inline_audit)
    validate_exact_ids(
        "inline clean audit", inline_wrap, canonical_ids, args.expected_count
    )
    inline_audit_manifest = read_json(args.inline_audit_manifest)
    if Path(str(inline_audit_manifest.get("output"))).resolve() != args.inline_audit.resolve():
        raise ValueError("inline clean-audit manifest points to a different output")
    if inline_audit_manifest.get("output_sha256") != EXPECTED_SHA256["inline_audit"]:
        raise ValueError("inline clean-audit manifest records a different output SHA")

    diagnostic = read_json(args.diagnostic)
    if Path(str(diagnostic.get("artifact"))).resolve() != args.inline_run.resolve():
        raise ValueError("diagnostic does not identify frozen inline run")
    if Path(str(diagnostic.get("judge"))).resolve() != args.inline_judge.resolve():
        raise ValueError("diagnostic does not identify frozen inline judge")
    diagnostic_rows = rows_by_id(
        diagnostic.get("rows") or [], "benchmark_query_id", args.diagnostic
    )
    validate_exact_ids(
        "pipeline diagnostic", diagnostic_rows, canonical_ids, args.expected_count
    )
    for query_id, row in diagnostic_rows.items():
        if row.get("question_type") != inline_rows[query_id].get("question_type"):
            raise ValueError(f"diagnostic question_type mismatch for {query_id}")
        if row.get("correct") != inline_judge_rows[query_id].get("label"):
            raise ValueError(f"diagnostic correctness mismatch for {query_id}")

    historical_run = read_json(args.historical_run)
    provenance = historical_run.get("rejudge_provenance")
    if not isinstance(provenance, dict) or provenance.get("kind") != "frozen_prediction_rejudge":
        raise ValueError("historical run is missing frozen_prediction_rejudge provenance")
    historical_rows = rows_by_id(
        historical_run.get("data") or [], "benchmark_query_id", args.historical_run
    )
    validate_exact_ids(
        "historical run", historical_rows, canonical_ids, args.expected_count
    )
    validate_source_rows("historical", historical_rows, inline_rows)
    validate_run_contract("historical", historical_run, inline_run)
    historical_judge = read_json(args.historical_judge)
    historical_judge_rows = validate_judge(
        "historical",
        args.historical_judge,
        historical_judge,
        args.historical_run,
        historical_rows,
        canonical_ids,
        args.expected_count,
    )
    historical_correct = sum(
        bool(row["label"]) for row in historical_judge_rows.values()
    )
    if historical_correct != args.expected_historical_correct:
        raise ValueError(
            f"historical correct={historical_correct}, "
            f"expected {args.expected_historical_correct}"
        )

    generation_audit = read_json(args.historical_generation_audit)
    expected_generation_summary = {
        "historical_original_rows": 500,
        "canonical_mab300_rows": args.expected_count,
        "overlap_question_ids": args.expected_count,
        "calendar_date_match": 124,
        "calendar_date_mismatch": 176,
        "full_question_datetime_match": 0,
        "full_question_datetime_mismatch": args.expected_count,
        "normalized_question_body_match": args.expected_count,
        "reference_answer_match": args.expected_count,
        "historical_rejudge_source_fields_match_canonical": args.expected_count,
    }
    if generation_audit.get("classification") != "accuracy_only_nonmatched_generation_reference":
        raise ValueError("historical generation audit has an unexpected classification")
    if generation_audit.get("summary") != expected_generation_summary:
        raise ValueError("historical generation audit summary differs from frozen audit")
    generation_rows = generation_audit.get("rows")
    if not isinstance(generation_rows, list) or len(generation_rows) != args.expected_count:
        raise ValueError("historical generation audit must contain 300 joined rows")

    paths = {
        "inline_run": args.inline_run,
        "inline_judge": args.inline_judge,
        "inline_audit": args.inline_audit,
        "inline_audit_manifest": args.inline_audit_manifest,
        "diagnostic": args.diagnostic,
        "historical_run": args.historical_run,
        "historical_judge": args.historical_judge,
        "historical_generation_audit": args.historical_generation_audit,
    }
    artifacts = {
        name: artifact_entry(path, EXPECTED_SHA256.get(name))
        for name, path in paths.items()
    }
    return {
        "inline_run": inline_run,
        "inline_rows": inline_rows,
        "inline_judge": inline_judge,
        "inline_judge_rows": inline_judge_rows,
        "inline_wrap": inline_wrap,
        "diagnostic": diagnostic,
        "diagnostic_rows": diagnostic_rows,
        "historical_run": historical_run,
        "historical_rows": historical_rows,
        "historical_judge": historical_judge,
        "historical_judge_rows": historical_judge_rows,
        "historical_provenance": provenance,
        "historical_generation_audit": generation_audit,
        "canonical_ids": canonical_ids,
        "artifacts": artifacts,
        "inline_correct": inline_correct,
        "historical_correct": historical_correct,
    }


def preparation_manifest(args: argparse.Namespace, baseline: dict[str, Any]) -> dict[str, Any]:
    inline_run = baseline["inline_run"]
    return {
        "schema_version": 1,
        "status": "prepared; final artifacts deliberately not read",
        "analysis_script": artifact_entry(Path(__file__).resolve()),
        "expected_count": args.expected_count,
        "sorted_id_list_sha256": sorted_id_list_sha(baseline["canonical_ids"]),
        "canonical_source_rows_sha256": canonical_rows_sha(
            baseline["inline_rows"], ("benchmark_query_id", *SOURCE_FIELDS)
        ),
        "canonical_judge_identity_sha256": canonical_rows_sha(
            baseline["inline_judge_rows"],
            ("benchmark_query_id", "question_id", "question_type"),
        ),
        "baseline_artifacts": baseline["artifacts"],
        "baseline_accuracy": {
            "inline_compose_v2": {
                "correct": baseline["inline_correct"],
                "count": args.expected_count,
            },
            "historical_best_current_gpt4o": {
                "correct": baseline["historical_correct"],
                "count": args.expected_count,
            },
        },
        "historical_reference_limit": {
            "classification": baseline["historical_generation_audit"]["classification"],
            "rejudge_provenance": baseline["historical_provenance"],
            "generation_comparability": baseline["historical_generation_audit"]["summary"],
            "interpretation": (
                "Question bodies and references match, but the historical frozen "
                "answers were generated with a different full timestamp for 300/300 "
                "rows and a different calendar date for 176/300. Use accuracy only; "
                "do not treat it as a fully matched harness ablation."
            ),
        },
        "judge_contract": dict(EXPECTED_JUDGE),
        "canonical_run_contract": {
            field: inline_run.get(field) for field in RUN_CONTRACT_FIELDS
        },
        "canonical_source_fields": list(SOURCE_FIELDS),
        "final_acceptance_gate": {
            "run": "exactly 300 canonical IDs, completed_queries=300, no unresolved failures",
            "judge": "exactly 300 canonical IDs, source_artifact points to final run, official GPT-4o pin matches",
            "audit": "exactly 300 unique canonical IDs; duplicates or missing rows rejected",
            "source": "question, reference answer, IDs, type, and query are byte-equivalent to canonical inline rows",
            "models": "answer and per-question retrieval provider/model/thinking/transport match inline-compose-v2",
            "mixed_seed_policy": "rejected because every final ID must have its own unique final wrap audit row",
        },
        "planned_outputs": [
            "clean-full300-comparison.json",
            "clean-full300-comparison.md",
            "clean-full300-paired.csv",
        ],
    }


def build_comparison(args: argparse.Namespace, baseline: dict[str, Any]) -> dict[str, Any]:
    for name in ("final_run", "final_judge", "final_audit"):
        if getattr(args, name) is None:
            raise ValueError(f"--{name.replace('_', '-')} is required outside --prepare-only")
    final_run_path: Path = args.final_run
    final_judge_path: Path = args.final_judge
    final_audit_path: Path = args.final_audit
    canonical_ids: set[str] = baseline["canonical_ids"]

    final_run = read_json(final_run_path)
    final_rows = rows_by_id(
        final_run.get("data") or [], "benchmark_query_id", final_run_path
    )
    validate_exact_ids("final run", final_rows, canonical_ids, args.expected_count)
    if final_run.get("completed_queries") != args.expected_count:
        raise ValueError("final run is incomplete")
    if final_run.get("failures") or final_run.get("retryable_failures"):
        raise ValueError("final run has unresolved failures")
    validate_source_rows("final", final_rows, baseline["inline_rows"])
    validate_run_contract("final", final_run, baseline["inline_run"])
    validate_final_memory_identity(final_run, baseline["inline_run"])
    validate_final_model_contract(
        final_run,
        baseline["inline_run"],
        final_rows,
        baseline["inline_rows"],
    )

    final_judge = read_json(final_judge_path)
    final_judge_rows = validate_judge(
        "final",
        final_judge_path,
        final_judge,
        final_run_path,
        final_rows,
        canonical_ids,
        args.expected_count,
    )
    final_wrap = wrap_rows_by_id(read_jsonl(final_audit_path), final_audit_path)
    validate_exact_ids("final clean audit", final_wrap, canonical_ids, args.expected_count)

    paired_rows: list[dict[str, Any]] = []
    for query_id in sorted(canonical_ids):
        diagnostic = baseline["diagnostic_rows"][query_id]
        correct = {
            "historical": bool(baseline["historical_judge_rows"][query_id]["label"]),
            "inline": bool(baseline["inline_judge_rows"][query_id]["label"]),
            "final": bool(final_judge_rows[query_id]["label"]),
        }
        final_pipeline = final_pipeline_record(
            final_wrap[query_id], diagnostic, correct["final"]
        )
        paired_rows.append(
            {
                "benchmark_query_id": query_id,
                "question_type": final_rows[query_id].get("question_type"),
                "inline_pipeline_stage": diagnostic.get("stage"),
                "final_pipeline_stage": final_pipeline["stage"],
                "final_pipeline": final_pipeline,
                "correct": correct,
                "cost": {
                    "inline": cost_record(
                        baseline["inline_rows"][query_id],
                        baseline["inline_wrap"][query_id],
                    ),
                    "final": cost_record(final_rows[query_id], final_wrap[query_id]),
                },
                "directory": directory_record(
                    final_wrap[query_id], diagnostic, correct["final"]
                ),
            }
        )

    final_only = [
        row for row in paired_rows if row["correct"]["final"] and not row["correct"]["inline"]
    ]
    inline_only = [
        row for row in paired_rows if not row["correct"]["final"] and row["correct"]["inline"]
    ]
    return {
        "schema_version": 1,
        "scope": "clean paired full300; no copied resume-seed controls",
        "sorted_id_list_sha256": sorted_id_list_sha(canonical_ids),
        "canonical_source_rows_sha256": canonical_rows_sha(
            baseline["inline_rows"], ("benchmark_query_id", *SOURCE_FIELDS)
        ),
        "canonical_judge_identity_sha256": canonical_rows_sha(
            baseline["inline_judge_rows"],
            ("benchmark_query_id", "question_id", "question_type"),
        ),
        "judge_contract": dict(EXPECTED_JUDGE),
        "artifacts": {
            **baseline["artifacts"],
            "final_run": artifact_entry(final_run_path),
            "final_judge": artifact_entry(final_judge_path),
            "final_audit": artifact_entry(final_audit_path),
        },
        "models": {
            "inline_answer": baseline["inline_run"].get("answer_model"),
            "inline_retrieval": baseline["inline_run"].get("retrieval_model_audit"),
            "historical_answer": baseline["historical_run"].get("answer_model"),
            "final_answer": final_run.get("answer_model"),
            "final_retrieval": final_run.get("retrieval_model_audit"),
        },
        "historical_reference_limit": {
            "classification": baseline["historical_generation_audit"]["classification"],
            "rejudge_provenance": baseline["historical_provenance"],
            "generation_comparability": baseline["historical_generation_audit"]["summary"],
            "cost_comparable": False,
        },
        "accuracy": {
            version: accuracy(paired_rows, version)
            for version in ("historical", "inline", "final")
        },
        "paired": [paired(paired_rows, "inline"), paired(paired_rows, "historical")],
        "by_question_type": accuracy_breakdown(paired_rows, "question_type"),
        "by_inline_pipeline_stage": accuracy_breakdown(
            paired_rows, "inline_pipeline_stage"
        ),
        "by_final_pipeline_stage": accuracy_breakdown(
            paired_rows, "final_pipeline_stage"
        ),
        "pipeline_stage_transitions": stage_transitions(paired_rows),
        "cost": {
            version: summarize_costs([row["cost"][version] for row in paired_rows])
            for version in ("inline", "final")
        },
        "directory_usage": {
            "definition": {
                "directory_origin": "stable C ref first appears in compact directory, before any full-passage appearance",
                "direct_read": "Agent explicitly names the directory-origin C ref in read(candidateRefs)",
                "trace_linked_gold_commit": "same directory-origin gold memory is exposed, explicitly read, and selectedMemoryIds commits it",
                "causality_limit": "trace linkage is necessary evidence, not proof that the score flip was caused by the directory",
            },
            "all": directory_counts(paired_rows),
            "final_only_vs_inline": directory_counts(final_only),
            "inline_only_vs_final": directory_counts(inline_only),
            "by_question_type": directory_breakdown(paired_rows, "question_type"),
            "by_inline_pipeline_stage": directory_breakdown(
                paired_rows, "inline_pipeline_stage"
            ),
            "by_final_pipeline_stage": directory_breakdown(
                paired_rows, "final_pipeline_stage"
            ),
        },
        "paired_rows": paired_rows,
    }


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{100 * value:.1f}%"


def number(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def table(headers: list[str], rows: list[list[Any]]) -> str:
    def clean(value: Any) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")

    lines = [
        "| " + " | ".join(map(clean, headers)) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend(
        "| " + " | ".join(clean(value) for value in row) + " |" for row in rows
    )
    return "\n".join(lines)


def render_markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Clean LongMemEval-S full300 paired comparison",
        "",
        "All judge inputs use the same 300 IDs, normalized question bodies, reference answers, and official GPT-4o judge prompt. Inline and final are the matched harness comparison. Historical best is accuracy-only: its frozen answers were generated with a different full timestamp for 300/300 rows and a different calendar date for 176/300, then grafted onto the canonical rows for rejudging. Cost is comparable only for inline and final. The final arm has 300 unique wrap audits, so no copied resume-seed controls are present.",
        "",
        f"- Sorted canonical ID-list SHA-256: `{result['sorted_id_list_sha256']}`",
        f"- Judge prompt SHA-256: `{result['judge_contract']['prompt_sha256']}`",
        "",
        "## Accuracy",
        "",
        table(
            ["Version", "Correct", "N", "Accuracy"],
            [
                [name, result["accuracy"][key]["correct"], result["accuracy"][key]["count"], pct(result["accuracy"][key]["accuracy"])]
                for key, name in (
                    ("historical", "Historical best current-GPT4o"),
                    ("inline", "Inline-compose-v2"),
                    ("final", "Final"),
                )
            ],
        ),
        "",
        "## Paired flips",
        "",
        table(
            ["Pair", "Both correct", "Final only", "Comparator only", "Both wrong", "Delta", "McNemar p"],
            [
                [
                    f"Final vs {item['comparator']}",
                    item["both_correct"],
                    item["final_only_correct"],
                    item["comparator_only_correct"],
                    item["both_wrong"],
                    pct(item["accuracy_delta"]),
                    number(item["mcnemar_exact_two_sided_p"], 4),
                ]
                for item in result["paired"]
            ],
        ),
    ]
    for key, title in (
        ("by_question_type", "Question type"),
        ("by_inline_pipeline_stage", "Inline pipeline stage"),
        ("by_final_pipeline_stage", "Final pipeline stage"),
    ):
        lines.extend(["", f"## {title}", ""])
        lines.append(
            table(
                ["Group", "N", "Historical", "Inline", "Final"],
                [
                    [row["group"], row["count"], pct(row["historical"]["accuracy"]), pct(row["inline"]["accuracy"]), pct(row["final"]["accuracy"])]
                    for row in result[key]
                ],
            )
        )
    lines.extend(["", "## Pipeline stage transitions", ""])
    lines.append(
        table(
            ["Inline stage", "Final stage", "N", "Inline correct", "Final correct"],
            [
                [
                    row["inline_stage"],
                    row["final_stage"],
                    row["count"],
                    row["inline_correct"],
                    row["final_correct"],
                ]
                for row in result["pipeline_stage_transitions"]
            ],
        )
    )
    lines.extend(["", "## Cost", ""])
    lines.append(
        table(
            ["Version", "Time mean", "Time p90", "Search", "Read", "Candidates", "Evidence", "Retrieval tokens", "Directory refs"],
            [
                [
                    version,
                    number(cost["query_time_seconds"]["mean"]),
                    number(cost["query_time_seconds"]["p90"]),
                    number(cost["search_calls"]["mean"], 2),
                    number(cost["read_calls"]["mean"], 2),
                    number(cost["candidate_count"]["mean"]),
                    number(cost["evidence_count"]["mean"], 2),
                    number(cost["retrieval_total_tokens"]["mean"], 0),
                    number(cost["directory_candidate_references_shown"]["mean"]),
                ]
                for version, cost in result["cost"].items()
            ],
        )
    )
    lines.extend(["", "## Directory trace chain", ""])
    directory_rows = []
    for name in ("all", "final_only_vs_inline", "inline_only_vs_final"):
        values = result["directory_usage"][name]
        directory_rows.append(
            [
                name,
                values["count"],
                values["directory_origin_exposed"],
                values["directory_origin_read"],
                values["directory_origin_committed"],
                values["directory_origin_has_gold"],
                values["directory_origin_gold_read"],
                values["trace_linked_directory_gold_commit"],
                values["trace_linked_directory_gold_commit_and_correct"],
            ]
        )
    lines.append(
        table(
            ["Stratum", "N", "Directory shown", "Read", "Commit", "Gold shown", "Gold read", "Gold read+commit", "+correct"],
            directory_rows,
        )
    )
    lines.extend(
        [
            "",
            "The directory chain is trace-linked, not a causal estimate. A paired flip without a directory-gold read and commit may come from search, selection, or answer variance.",
            "",
        ]
    )
    return "\n".join(lines)


def write_comparison(result: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "clean-full300-comparison.json"
    markdown_path = output_dir / "clean-full300-comparison.md"
    csv_path = output_dir / "clean-full300-paired.csv"
    json_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(render_markdown(result), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        fields = [
            "benchmark_query_id",
            "question_type",
            "inline_pipeline_stage",
            "final_pipeline_stage",
            "historical_correct",
            "inline_correct",
            "final_correct",
            *DIRECTORY_FLAGS,
        ]
        for version in ("inline", "final"):
            fields.extend(f"{version}_{field}" for field in COST_FIELDS)
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in result["paired_rows"]:
            flat: dict[str, Any] = {
                "benchmark_query_id": row["benchmark_query_id"],
                "question_type": row["question_type"],
                "inline_pipeline_stage": row["inline_pipeline_stage"],
                "final_pipeline_stage": row["final_pipeline_stage"],
                **{f"{version}_correct": int(row["correct"][version]) for version in ("historical", "inline", "final")},
                **{flag: int(bool(row["directory"][flag])) for flag in DIRECTORY_FLAGS},
            }
            for version in ("inline", "final"):
                for field in COST_FIELDS:
                    flat[f"{version}_{field}"] = row["cost"][version][field]
            writer.writerow(flat)
    print(
        json.dumps(
            {"json": str(json_path), "markdown": str(markdown_path), "csv": str(csv_path)},
            ensure_ascii=False,
            indent=2,
        )
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--prepare-only", action="store_true")
    result.add_argument("--output-dir", type=Path, required=True)
    result.add_argument("--inline-run", type=Path, default=DEFAULT_INLINE_RUN)
    result.add_argument("--inline-judge", type=Path, default=DEFAULT_INLINE_JUDGE)
    result.add_argument("--inline-audit", type=Path, default=DEFAULT_INLINE_AUDIT)
    result.add_argument(
        "--inline-audit-manifest",
        type=Path,
        default=DEFAULT_INLINE_AUDIT_MANIFEST,
    )
    result.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    result.add_argument("--historical-run", type=Path, default=DEFAULT_HISTORICAL_RUN)
    result.add_argument("--historical-judge", type=Path, default=DEFAULT_HISTORICAL_JUDGE)
    result.add_argument(
        "--historical-generation-audit",
        type=Path,
        default=DEFAULT_HISTORICAL_GENERATION_AUDIT,
    )
    result.add_argument("--final-run", type=Path)
    result.add_argument("--final-judge", type=Path)
    result.add_argument("--final-audit", type=Path)
    result.add_argument("--expected-count", type=int, default=300)
    result.add_argument("--expected-inline-correct", type=int, default=239)
    result.add_argument("--expected-historical-correct", type=int, default=255)
    return result


def main() -> None:
    args = parser().parse_args()
    if args.prepare_only and any(
        value is not None for value in (args.final_run, args.final_judge, args.final_audit)
    ):
        raise ValueError("--prepare-only refuses final artifact arguments")
    baseline = load_baselines(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.prepare_only:
        manifest = preparation_manifest(args, baseline)
        path = args.output_dir / "clean-full300-comparison-preparation.json"
        path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"preparation_manifest": str(path)}, indent=2))
        return
    write_comparison(build_comparison(args, baseline), args.output_dir)


if __name__ == "__main__":
    main()
