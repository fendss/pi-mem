#!/usr/bin/env python3
"""Paired, read-only analysis for the controlled LongMemEval-S 84-question run.

The three controlled artifacts contain 300 rows because 216 baseline controls
are pre-seeded.  The historical-best artifact is an accuracy-only frozen-
prediction rejudge. This script deliberately compares only the 84 IDs frozen in
the regression manifest. It never calls a model, memory service, suite, or judge.
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
from pathlib import Path
from typing import Any, Iterable


EVAL_ROOT = Path(os.environ.get("PIMEM_EVAL_ROOT", "artifacts"))

DEFAULT_ROOT = EVAL_ROOT / "lme300-controlled-regression-20260830"

DEFAULT_HISTORICAL_ROOT = EVAL_ROOT / (
    "refind-protocol-20260824/"
    "full-native-observation-v5-lme-s500-budget4-composite-s128-run1"
)

DEFAULT_HISTORICAL_RUN = (
    DEFAULT_HISTORICAL_ROOT
    / "evaluation/current-gpt4o-mab300-rejudge/input/longmemeval-s-static.json"
)

DEFAULT_HISTORICAL_JUDGE = (
    DEFAULT_HISTORICAL_ROOT
    / "evaluation/current-gpt4o-mab300-rejudge/output/longmemeval-s-static.json"
)

EXPECTED_HISTORICAL_RUN_SHA256 = (
    "535e2bc9d73fc03d7281df42db0372bb26b8c06570def88b4ff3e08e81636df1"
)

EXPECTED_HISTORICAL_JUDGE_SHA256 = (
    "47add711f49c1036b5edb1c07490bdc00b6a30859756634d11f3714a10ae0b4b"
)

VERSION_SPECS = {
    "v1": {
        "display_name": "V1 evidence-transaction reservoir",
        "run": "runs/controlled-regression-84-v1/longmemeval-s-static.json",
        "judge": "evaluation/gpt4o-official-guard84/longmemeval-s-static.json",
        "wrap": "runtime-snapshot/memory-service/wrap-audits.jsonl",
    },
    "v2": {
        "display_name": "V2 skill-coverage",
        "run": (
            "runs/controlled-regression-84-skill-coverage-v2/"
            "longmemeval-s-static.json"
        ),
        "judge": (
            "evaluation/gpt4o-official-skill-coverage-v2/"
            "longmemeval-s-static.json"
        ),
        "wrap": (
            "runtime-snapshot-skill-coverage-v2/memory-service/"
            "wrap-audits.jsonl"
        ),
    },
    "v3": {
        "display_name": "V3 two-layer candidate directory",
        "run": (
            "runs/controlled-regression-84-directory-v3/"
            "longmemeval-s-static.json"
        ),
        "judge": (
            "evaluation/gpt4o-official-guard84-directory-v3/"
            "longmemeval-s-static.json"
        ),
        "wrap": (
            "runtime-snapshot-directory-v3/memory-service/"
            "wrap-audits.jsonl"
        ),
    },
}

ACCURACY_DISPLAY_NAMES = {
    "historical": "Historical best (frozen LME-S500 predictions)",
    **{version: spec["display_name"] for version, spec in VERSION_SPECS.items()},
}

ACCURACY_VERSIONS = ("historical", "v1", "v2", "v3")

EXPECTED_JUDGE = {
    "judge_model": "gpt-4o",
    "official_prompt_source_commit": (
        "fe1735de8cf8b9908e1e3d3b5612afc815698062"
    ),
    "prompt_sha256": (
        "2c90b57efc5142071e32e10b3b131bbad6ee37626b6287d007ab1f52a2cdf54d"
    ),
    "mode": "static",
}

RUN_CONTRACT_FIELDS = (
    "answer_model",
    "answer_request_policy",
    "benchmark_commit",
    "dataset_revision",
    "query_template_sha256",
    "memorize_template_sha256",
    "official_config",
    "memory_request_policy",
    "ingestion_strategy",
    "ingestion_reuse",
    "source",
    "task",
    "capability",
)

TARGET_SOURCE_FIELDS = (
    "context_id",
    "qa_pair_id",
    "question_id",
    "question_type",
    "query",
    "answer",
)

GROUP_FIELDS = (
    ("regression_role", "Role"),
    ("category", "Category"),
    ("pipeline_stage", "Pipeline stage"),
    ("question_type", "Question type"),
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


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number} must be a JSON object")
            rows.append(value)
    return rows


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def unique_by(
    rows: Iterable[dict[str, Any]], key: str, source: Path
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"{source}: every row must have a non-empty {key}")
        if value in result:
            raise ValueError(f"{source}: duplicate {key} {value!r}")
        result[value] = row
    return result


def wrap_query_id(row: dict[str, Any]) -> str | None:
    direct = row.get("operatorExperiment")
    nested = row.get("retrieval", {}).get("operatorExperiment")
    for value in (direct, nested):
        if isinstance(value, dict) and isinstance(value.get("questionId"), str):
            return value["questionId"]
    return None


def index_wrap_audits(
    rows: Iterable[dict[str, Any]], source: Path
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        query_id = wrap_query_id(row)
        if not query_id:
            raise ValueError(f"{source}: wrap row has no operator questionId")
        if query_id in result:
            raise ValueError(f"{source}: duplicate wrap audit for {query_id!r}")
        result[query_id] = row
    return result


def numeric(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return default


def trace_summary(wrap: dict[str, Any]) -> dict[str, float]:
    trace = wrap.get("retrieval", {}).get("trace", [])
    if not isinstance(trace, list):
        trace = []
    tool_counts: Counter[str] = Counter()
    error_count = 0
    full_refs: set[str] = set()
    directory_refs: set[str] = set()
    reservoir_total = 0.0
    for call in trace:
        if not isinstance(call, dict):
            continue
        tool = str(call.get("toolName", "unknown"))
        tool_counts[tool] += 1
        if call.get("isError") is True:
            error_count += 1
            continue
        if tool not in {"search", "search_more"}:
            continue
        details = call.get("details")
        if not isinstance(details, dict):
            continue
        for ref in details.get("candidateReferences", []):
            if isinstance(ref, dict):
                identity = ref.get("memoryId") or ref.get("candidateId")
                if isinstance(identity, str):
                    full_refs.add(identity)
        for ref in details.get("directoryCandidateReferences", []):
            if isinstance(ref, dict):
                identity = ref.get("memoryId") or ref.get("candidateId")
                if isinstance(identity, str):
                    directory_refs.add(identity)
        physical = details.get("physicalPlan")
        if isinstance(physical, dict):
            reservoir_total += numeric(physical.get("candidateReservoirCount"))
    return {
        "trace_search_calls": float(tool_counts["search"]),
        "trace_search_more_calls": float(tool_counts["search_more"]),
        "trace_read_calls": float(tool_counts["read"]),
        "trace_error_calls": float(error_count),
        "full_candidate_references_shown": float(len(full_refs)),
        "directory_candidate_references_shown": float(len(directory_refs)),
        "physical_reservoir_candidates": reservoir_total,
    }


def cost_record(
    run_row: dict[str, Any], wrap: dict[str, Any]
) -> dict[str, float]:
    retrieval = wrap.get("retrieval", {})
    usage = retrieval.get("usage", {}) if isinstance(retrieval, dict) else {}
    audit = retrieval.get("audit", {}) if isinstance(retrieval, dict) else {}
    metrics = audit.get("metrics", {}) if isinstance(audit, dict) else {}
    operator = run_row.get("operator_experiment", {})
    result = {
        "query_time_seconds": numeric(run_row.get("query_time_seconds")),
        "search_calls": numeric(
            metrics.get("searchCalls", operator.get("searchCalls", 0))
        ),
        "read_calls": numeric(metrics.get("readCalls")),
        "candidate_count": numeric(metrics.get("candidateCount")),
        "inspected_evidence_count": numeric(
            metrics.get("inspectedEvidenceCount")
        ),
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
    summary: dict[str, Any] = {"count": len(rows)}
    for field in COST_FIELDS:
        values = [numeric(row.get(field)) for row in rows]
        summary[field] = {
            "total": sum(values),
            "mean": statistics.fmean(values) if values else None,
            "median": statistics.median(values) if values else None,
            "p90": percentile(values, 0.9),
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    return summary


def accuracy(rows: list[dict[str, Any]], version: str) -> dict[str, Any]:
    correct = sum(row["correct"][version] for row in rows)
    return {
        "count": len(rows),
        "correct": correct,
        "accuracy": correct / len(rows) if rows else None,
    }


def breakdown(
    rows: list[dict[str, Any]], field: str
) -> list[dict[str, Any]]:
    groups: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row[field])].append(row)
    result = []
    for name in sorted(groups):
        group = groups[name]
        item: dict[str, Any] = {"group": name, "count": len(group)}
        for version in ACCURACY_VERSIONS:
            item[version] = accuracy(group, version)
        item["delta_v3_minus_v1"] = (
            item["v3"]["accuracy"] - item["v1"]["accuracy"]
        )
        item["delta_v3_minus_historical"] = (
            item["v3"]["accuracy"] - item["historical"]["accuracy"]
        )
        item["delta_v3_minus_v2"] = (
            item["v3"]["accuracy"] - item["v2"]["accuracy"]
        )
        result.append(item)
    return result


def exact_mcnemar_p(v3_only: int, comparator_only: int) -> float:
    discordant = v3_only + comparator_only
    if discordant == 0:
        return 1.0
    tail = min(v3_only, comparator_only)
    probability = sum(
        math.comb(discordant, k) for k in range(tail + 1)
    ) / (2**discordant)
    return min(1.0, 2 * probability)


def paired_summary(
    rows: list[dict[str, Any]], comparator: str
) -> dict[str, Any]:
    both_correct = sum(
        row["correct"]["v3"] and row["correct"][comparator] for row in rows
    )
    v3_only = sum(
        row["correct"]["v3"] and not row["correct"][comparator]
        for row in rows
    )
    comparator_only = sum(
        not row["correct"]["v3"] and row["correct"][comparator]
        for row in rows
    )
    both_wrong = len(rows) - both_correct - v3_only - comparator_only
    return {
        "comparator": comparator,
        "count": len(rows),
        "both_correct": both_correct,
        "v3_only_correct": v3_only,
        "comparator_only_correct": comparator_only,
        "both_wrong": both_wrong,
        "accuracy_delta": (
            (v3_only - comparator_only) / len(rows) if rows else None
        ),
        "mcnemar_exact_two_sided_p": exact_mcnemar_p(
            v3_only, comparator_only
        ),
    }


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{100 * value:.1f}%"


def number(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    def clean(value: Any) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")

    lines = [
        "| " + " | ".join(map(clean, headers)) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend(
        "| " + " | ".join(clean(value) for value in row) + " |"
        for row in rows
    )
    return "\n".join(lines)


def render_markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Controlled LME-S84: V3 paired comparison",
        "",
        (
            "This report compares only the 84 frozen manifest IDs. In V1/V2/V3, "
            "the other 216 rows are identical pre-seeded controls and are not "
            "independent observations. Historical best is an accuracy-only "
            "reference rejudged with the same official GPT-4o prompt; its cost "
            "metadata is not comparable."
        ),
        "",
        f"- Comparable rows: {result['common_complete_count']}/84",
        f"- Manifest SHA-256: `{result['manifest']['sha256']}`",
        f"- Judge: `{result['judge_contract']['judge_model']}`",
        f"- Official prompt commit: `{result['judge_contract']['official_prompt_source_commit']}`",
        f"- Prompt SHA-256: `{result['judge_contract']['prompt_sha256']}`",
    ]
    if result["warnings"]:
        lines += ["", "## Warnings", ""]
        lines.extend(f"- {warning}" for warning in result["warnings"])

    lines += ["", "## Accuracy on the paired manifest rows", ""]
    accuracy_rows = []
    for version in ACCURACY_VERSIONS:
        score = result["overall_accuracy"][version]
        accuracy_rows.append(
            [ACCURACY_DISPLAY_NAMES[version], score["correct"], score["count"], pct(score["accuracy"])]
        )
    lines.append(
        markdown_table(["Version", "Correct", "N", "Accuracy"], accuracy_rows)
    )

    lines += ["", "## Paired changes", ""]
    paired_rows = []
    for item in result["paired"]:
        paired_rows.append(
            [
                f"V3 vs {ACCURACY_DISPLAY_NAMES[item['comparator']]}",
                item["count"],
                item["both_correct"],
                item["v3_only_correct"],
                item["comparator_only_correct"],
                item["both_wrong"],
                pct(item["accuracy_delta"]),
                number(item["mcnemar_exact_two_sided_p"], 4),
            ]
        )
    lines.append(
        markdown_table(
            [
                "Pair",
                "N",
                "Both correct",
                "V3 only",
                "Comparator only",
                "Both wrong",
                "Delta",
                "McNemar p",
            ],
            paired_rows,
        )
    )

    for field, title in GROUP_FIELDS:
        lines += ["", f"## {title} breakdown", ""]
        group_rows = []
        for item in result["breakdowns"][field]:
            group_rows.append(
                [
                    item["group"],
                    item["count"],
                    pct(item["historical"]["accuracy"]),
                    pct(item["v1"]["accuracy"]),
                    pct(item["v2"]["accuracy"]),
                    pct(item["v3"]["accuracy"]),
                    pct(item["delta_v3_minus_historical"]),
                    pct(item["delta_v3_minus_v1"]),
                    pct(item["delta_v3_minus_v2"]),
                ]
            )
        lines.append(
            markdown_table(
                [
                    "Group",
                    "N",
                    "Historical",
                    "V1",
                    "V2",
                    "V3",
                    "V3-Hist",
                    "V3-V1",
                    "V3-V2",
                ],
                group_rows,
            )
        )

    lines += ["", "## Retrieval-agent cost and harness activity", ""]
    lines.append(
        "Token fields cover the retrieval agent only; the run artifact does not "
        "record answer-model token usage. Query time covers the end-to-end query."
    )
    lines.append("")
    cost_rows = []
    for version, spec in VERSION_SPECS.items():
        costs = result["costs"][version]
        cost_rows.append(
            [
                spec["display_name"],
                costs["count"],
                number(costs["query_time_seconds"]["mean"]),
                number(costs["query_time_seconds"]["p90"]),
                number(costs["search_calls"]["mean"], 2),
                number(costs["read_calls"]["mean"], 2),
                number(costs["candidate_count"]["mean"], 1),
                number(costs["evidence_count"]["mean"], 2),
                number(costs["retrieval_total_tokens"]["mean"], 0),
                number(
                    costs["directory_candidate_references_shown"]["mean"], 1
                ),
                number(costs["trace_search_more_calls"]["mean"], 2),
            ]
        )
    lines.append(
        markdown_table(
            [
                "Version",
                "N",
                "Time mean (s)",
                "Time p90 (s)",
                "Search mean",
                "Read mean",
                "Candidates mean",
                "Evidence mean",
                "Retrieval tokens mean",
                "Directory refs mean",
                "search_more mean",
            ],
            cost_rows,
        )
    )

    lines += ["", "## Discordant questions", ""]
    discordant = [
        row
        for row in result["paired_rows"]
        if len(set(row["correct"].values())) > 1
    ]
    lines.append(
        markdown_table(
            [
                "Benchmark query ID",
                "Role",
                "Category",
                "Stage",
                "Type",
                "Historical",
                "V1",
                "V2",
                "V3",
            ],
            [
                [
                    row["benchmark_query_id"],
                    row["regression_role"],
                    row["category"],
                    row["pipeline_stage"],
                    row["question_type"],
                    int(row["correct"]["historical"]),
                    int(row["correct"]["v1"]),
                    int(row["correct"]["v2"]),
                    int(row["correct"]["v3"]),
                ]
                for row in discordant
            ],
        )
    )
    lines.append("")
    return "\n".join(lines)


def build_result(
    root: Path,
    historical_run_path: Path,
    historical_judge_path: Path,
    allow_incomplete: bool,
) -> dict[str, Any]:
    manifest_path = root / "artifacts/regression-84-manifest.json"
    directory_manifest_path = root / "artifacts/directory-v3/regression-84-manifest.json"
    manifest = read_json(manifest_path)
    targets = manifest.get("targets")
    if not isinstance(targets, list) or len(targets) != 84:
        raise ValueError(f"{manifest_path} must contain exactly 84 targets")
    target_map = unique_by(targets, "benchmark_query_id", manifest_path)
    if directory_manifest_path.exists() and sha256(directory_manifest_path) != sha256(manifest_path):
        raise ValueError("directory-v3 manifest differs from the frozen root manifest")

    versions: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    for version, spec in VERSION_SPECS.items():
        run_path = root / spec["run"]
        judge_path = root / spec["judge"]
        wrap_path = root / spec["wrap"]
        run = read_json(run_path)
        judge = read_json(judge_path)
        run_rows = unique_by(run.get("data", []), "benchmark_query_id", run_path)
        judge_rows = unique_by(judge.get("data", []), "benchmark_query_id", judge_path)
        wrap_rows = index_wrap_audits(read_jsonl(wrap_path), wrap_path)

        for key, expected in EXPECTED_JUDGE.items():
            if judge.get(key) != expected:
                message = (
                    f"{version} judge {key}={judge.get(key)!r}; expected {expected!r}"
                )
                if allow_incomplete and version == "v3":
                    warnings.append(message)
                else:
                    raise ValueError(message)
        expected_source_suffix = spec["run"]
        recorded_source = judge.get("source_artifact")
        source_matches = isinstance(recorded_source, str) and recorded_source.endswith(
            expected_source_suffix
        )
        if not source_matches:
            message = (
                f"{version} judge source_artifact is {recorded_source!r}; "
                f"expected suffix {expected_source_suffix!r}"
            )
            if allow_incomplete and version == "v3":
                warnings.append(message)
            else:
                raise ValueError(message)

        target_run_ids = set(target_map) & set(run_rows)
        target_judge_ids = set(target_map) & set(judge_rows)
        target_wrap_ids = set(target_map) & set(wrap_rows)
        complete_ids = target_run_ids & target_judge_ids & target_wrap_ids
        counts = {
            "run_target_rows": len(target_run_ids),
            "judge_target_rows": len(target_judge_ids),
            "wrap_target_rows": len(target_wrap_ids),
            "complete_target_rows": len(complete_ids),
            "run_total_rows": len(run_rows),
            "judge_total_rows": len(judge_rows),
            "wrap_total_rows": len(wrap_rows),
        }
        if len(complete_ids) != 84:
            message = f"{version} is incomplete: {counts}"
            if not allow_incomplete or version != "v3":
                raise ValueError(message)
            warnings.append(message)
        versions[version] = {
            "run_path": str(run_path),
            "judge_path": str(judge_path),
            "wrap_path": str(wrap_path),
            "run": run,
            "judge": judge,
            "run_rows": run_rows,
            "judge_rows": judge_rows,
            "wrap_rows": wrap_rows,
            "complete_ids": complete_ids,
            "counts": counts,
        }

    historical_run = read_json(historical_run_path)
    historical_judge = read_json(historical_judge_path)
    if sha256(historical_run_path) != EXPECTED_HISTORICAL_RUN_SHA256:
        raise ValueError("historical run does not match the frozen 65/84 artifact")
    if sha256(historical_judge_path) != EXPECTED_HISTORICAL_JUDGE_SHA256:
        raise ValueError("historical judge does not match the frozen 65/84 artifact")
    for key, expected in EXPECTED_JUDGE.items():
        if historical_judge.get(key) != expected:
            raise ValueError(
                f"historical judge {key}={historical_judge.get(key)!r}; "
                f"expected {expected!r}"
            )
    historical_provenance = historical_run.get("rejudge_provenance")
    if not isinstance(historical_provenance, dict) or historical_provenance.get(
        "kind"
    ) != "frozen_prediction_rejudge":
        raise ValueError("historical run is missing frozen_prediction_rejudge provenance")
    historical_run_rows = unique_by(
        historical_run.get("data", []), "benchmark_query_id", historical_run_path
    )
    historical_judge_rows = unique_by(
        historical_judge.get("data", []),
        "benchmark_query_id",
        historical_judge_path,
    )
    historical_complete_ids = (
        set(target_map) & set(historical_run_rows) & set(historical_judge_rows)
    )
    if len(historical_complete_ids) != 84:
        raise ValueError(
            "historical reference must contain all 84 frozen manifest IDs"
        )

    common_ids = set(target_map)
    for version in VERSION_SPECS:
        common_ids &= versions[version]["complete_ids"]
    common_ids &= historical_complete_ids
    if len(common_ids) != 84 and not allow_incomplete:
        raise ValueError(f"only {len(common_ids)}/84 IDs are complete in all versions")

    reference = versions["v1"]
    run_contract = {
        field: reference["run"].get(field) for field in RUN_CONTRACT_FIELDS
    }
    for version in ("v2", "v3"):
        for field, expected in run_contract.items():
            observed = versions[version]["run"].get(field)
            if canonical_json(observed) != canonical_json(expected):
                raise ValueError(
                    f"{version} run contract field {field} differs from V1"
                )

    reference_run_controls = {
        query_id: row
        for query_id, row in reference["run_rows"].items()
        if query_id not in target_map
    }
    reference_judge_controls = {
        query_id: row
        for query_id, row in reference["judge_rows"].items()
        if query_id not in target_map
    }
    if len(reference_run_controls) != 216 or len(reference_judge_controls) != 216:
        raise ValueError("V1 must contain exactly 216 run and judge controls")
    for version in ("v2", "v3"):
        run_controls = {
            query_id: row
            for query_id, row in versions[version]["run_rows"].items()
            if query_id not in target_map
        }
        judge_controls = {
            query_id: row
            for query_id, row in versions[version]["judge_rows"].items()
            if query_id not in target_map
        }
        if canonical_json(run_controls) != canonical_json(reference_run_controls):
            raise ValueError(f"{version} 216-row run controls differ from V1")
        if canonical_json(judge_controls) != canonical_json(reference_judge_controls):
            raise ValueError(f"{version} 216-row judge controls differ from V1")

    for version, values in versions.items():
        for query_id in values["complete_ids"]:
            run_row = values["run_rows"][query_id]
            v1_row = reference["run_rows"].get(query_id)
            if v1_row is not None:
                for field in TARGET_SOURCE_FIELDS:
                    if canonical_json(run_row.get(field)) != canonical_json(
                        v1_row.get(field)
                    ):
                        raise ValueError(
                            f"{version} source field {field} differs for {query_id}"
                        )
            judge_row = values["judge_rows"][query_id]
            for field in ("question_id", "question_type"):
                if judge_row.get(field) != run_row.get(field):
                    raise ValueError(
                        f"{version} judge {field} differs from run for {query_id}"
                    )

    historical_common_contract_fields = (
        "answer_model",
        "answer_request_policy",
        "benchmark_commit",
        "dataset_revision",
        "query_template_sha256",
        "memorize_template_sha256",
        "official_config",
        "memory_request_policy",
        "source",
        "task",
        "capability",
    )
    for field in historical_common_contract_fields:
        if canonical_json(historical_run.get(field)) != canonical_json(
            reference["run"].get(field)
        ):
            raise ValueError(
                f"historical run contract field {field} differs from V1"
            )
    for query_id in historical_complete_ids:
        run_row = historical_run_rows[query_id]
        v1_row = reference["run_rows"][query_id]
        for field in TARGET_SOURCE_FIELDS:
            if canonical_json(run_row.get(field)) != canonical_json(v1_row.get(field)):
                raise ValueError(
                    f"historical source field {field} differs for {query_id}"
                )
        judge_row = historical_judge_rows[query_id]
        for field in ("question_id", "question_type"):
            if judge_row.get(field) != run_row.get(field):
                raise ValueError(
                    f"historical judge {field} differs from run for {query_id}"
                )

    paired_rows: list[dict[str, Any]] = []
    for query_id in sorted(common_ids):
        target = target_map[query_id]
        row: dict[str, Any] = {
            "benchmark_query_id": query_id,
            "regression_role": target["regression_role"],
            "category": target["category"],
            "pipeline_stage": target["pipeline_stage"],
            "question_type": target["question_type"],
            "baseline_judge_label": target["baseline_judge_label"],
            "correct": {},
            "cost": {},
        }
        historical_label = historical_judge_rows[query_id].get("label")
        if not isinstance(historical_label, bool):
            raise ValueError(
                f"historical judge label for {query_id} is not bool"
            )
        row["correct"]["historical"] = historical_label
        for version in VERSION_SPECS:
            judge_row = versions[version]["judge_rows"][query_id]
            label = judge_row.get("label")
            if not isinstance(label, bool):
                raise ValueError(f"{version} judge label for {query_id} is not bool")
            row["correct"][version] = label
            row["cost"][version] = cost_record(
                versions[version]["run_rows"][query_id],
                versions[version]["wrap_rows"][query_id],
            )
        paired_rows.append(row)

    result: dict[str, Any] = {
        "schema_version": 1,
        "analysis_scope": (
            "paired comparison of the frozen 84 manifest IDs; excludes 216 "
            "pre-seeded controls"
        ),
        "root": str(root),
        "manifest": {
            "path": str(manifest_path),
            "sha256": sha256(manifest_path),
            "target_count": len(target_map),
        },
        "judge_contract": dict(EXPECTED_JUDGE),
        "run_contract": run_contract,
        "seed_control_validation": {
            "count": 216,
            "scope": "controlled V1/V2/V3 only",
            "run_rows_identical_across_controlled_versions": True,
            "judge_rows_identical_across_controlled_versions": True,
        },
        "versions": {
            version: {
                "display_name": VERSION_SPECS[version]["display_name"],
                "run_path": values["run_path"],
                "judge_path": values["judge_path"],
                "wrap_path": values["wrap_path"],
                "counts": values["counts"],
                "answer_model": values["run"].get("answer_model"),
                "retrieval_model_audit": values["run"].get(
                    "retrieval_model_audit"
                ),
                "judge_response_models": sorted(
                    {
                        row.get("response_model")
                        for row in values["judge_rows"].values()
                        if row.get("response_model")
                    }
                ),
            }
            for version, values in versions.items()
        },
        "historical_reference": {
            "display_name": ACCURACY_DISPLAY_NAMES["historical"],
            "run_path": str(historical_run_path),
            "run_sha256": sha256(historical_run_path),
            "judge_path": str(historical_judge_path),
            "judge_sha256": sha256(historical_judge_path),
            "target_count": len(historical_complete_ids),
            "answer_model": historical_run.get("answer_model"),
            "judge_response_models": sorted(
                {
                    row.get("response_model")
                    for row in historical_judge_rows.values()
                    if row.get("response_model")
                }
            ),
            "rejudge_provenance": historical_provenance,
            "cost_metrics_available": False,
            "cost_exclusion_reason": (
                "The MAB300 rejudge input grafts frozen LME-S500 predictions "
                "onto a later row template. Its query-time/operator fields and "
                "the old traces are not schema-comparable to V1/V2/V3 wrap audits."
            ),
        },
        "warnings": warnings,
        "common_complete_count": len(paired_rows),
        "overall_accuracy": {
            version: accuracy(paired_rows, version) for version in ACCURACY_VERSIONS
        },
        "paired": [
            paired_summary(paired_rows, "historical"),
            paired_summary(paired_rows, "v1"),
            paired_summary(paired_rows, "v2"),
        ],
        "breakdowns": {
            field: breakdown(paired_rows, field) for field, _ in GROUP_FIELDS
        },
        "costs": {
            version: summarize_costs(
                [row["cost"][version] for row in paired_rows]
            )
            for version in VERSION_SPECS
        },
        "paired_rows": paired_rows,
    }
    return result


def write_outputs(result: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "controlled-regression-v3-comparison.json"
    markdown_path = output_dir / "controlled-regression-v3-comparison.md"
    csv_path = output_dir / "controlled-regression-v3-paired.csv"
    json_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(render_markdown(result), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        fieldnames = [
            "benchmark_query_id",
            "regression_role",
            "category",
            "pipeline_stage",
            "question_type",
            "historical_correct",
            "v1_correct",
            "v2_correct",
            "v3_correct",
        ]
        for version in VERSION_SPECS:
            fieldnames.extend(f"{version}_{field}" for field in COST_FIELDS)
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in result["paired_rows"]:
            flat = {
                key: row[key]
                for key in (
                    "benchmark_query_id",
                    "regression_role",
                    "category",
                    "pipeline_stage",
                    "question_type",
                )
            }
            for version in ACCURACY_VERSIONS:
                flat[f"{version}_correct"] = int(row["correct"][version])
            for version in VERSION_SPECS:
                for field in COST_FIELDS:
                    flat[f"{version}_{field}"] = row["cost"][version][field]
            writer.writerow(flat)
    print(json.dumps({
        "json": str(json_path),
        "markdown": str(markdown_path),
        "csv": str(csv_path),
        "common_complete_count": result["common_complete_count"],
        "warnings": result["warnings"],
    }, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument(
        "--historical-run", type=Path, default=DEFAULT_HISTORICAL_RUN
    )
    parser.add_argument(
        "--historical-judge", type=Path, default=DEFAULT_HISTORICAL_JUDGE
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Permit an unfinished V3 only for schema/dry-run validation.",
    )
    args = parser.parse_args()
    result = build_result(
        args.root,
        args.historical_run,
        args.historical_judge,
        args.allow_incomplete,
    )
    write_outputs(result, args.output_dir)


if __name__ == "__main__":
    main()
