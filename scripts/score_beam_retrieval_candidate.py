#!/usr/bin/env python3
"""Compare a gold-blind BEAM retrieval candidate with the official-run baseline."""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path
from typing import Any

from analyze_beam_official_results import (
    evidence_groups,
    load_raw_questions,
    load_session_counts,
    marker_set,
    read_json,
    read_jsonl,
    stage_metrics,
    write_json,
)
from score_beam_coverage_replay import request_fingerprint


def artifact_map(directory: Path, allowed: set[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in directory.glob("*.json"):
        try:
            artifact = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if artifact.get("status") != "ok":
            continue
        fingerprint = request_fingerprint(artifact.get("search", {}))
        if fingerprint in allowed and fingerprint not in result:
            result[fingerprint] = artifact
    return result


def plan_stats(artifact: dict[str, Any]) -> tuple[int, int]:
    calls = queries = 0
    for event in artifact["agent"]["reasoning_trace"]:
        if event.get("toolName") != "search":
            continue
        calls += 1
        arguments = event.get("args") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {}
        queries += len(arguments.get("queries") or [])
    return calls, queries


def artifact_row(
    artifact: dict[str, Any],
    groups: list[list[str]],
) -> dict[str, Any]:
    memory = artifact["agent"]["memory"]
    cited = [item for item in memory["searched_memories"] if item.get("cited")]
    selection = artifact["agent"]["selection"]
    search_calls, planned_queries = plan_stats(artifact)
    return {
        "harness_version": artifact.get("harness_version", "legacy-unrecorded"),
        "status": selection["status"],
        "candidate_count": len(memory["searched_memories"]),
        "read_count": len(memory["read_evidence"]),
        "cited_count": len(cited),
        "search_call_count": search_calls,
        "planned_query_count": planned_queries,
        "candidate": stage_metrics(groups, marker_set(memory["searched_memories"])),
        "read": stage_metrics(groups, marker_set(memory["read_evidence"])),
        "cited": stage_metrics(groups, marker_set(cited)),
    }


def summarize(rows: list[dict[str, Any]], side: str) -> dict[str, Any]:
    selected = [row[side] for row in rows]
    evidence = [row for row in rows if row["expected_group_count"]]
    groups = sum(row["expected_group_count"] for row in evidence)
    markers = sum(row["expected_marker_count"] for row in evidence)

    def ratio(numerator: int, denominator: int) -> float | None:
        return numerator / denominator if denominator else None

    def stage(name: str) -> dict[str, Any]:
        return {
            "marker_recall": ratio(
                sum(row[side][name]["marker_hits"] for row in evidence), markers
            ),
            "group_recall": ratio(
                sum(row[side][name]["group_hits"] for row in evidence), groups
            ),
            "questions_with_all_groups": ratio(
                sum(row[side][name]["all_groups"] for row in evidence), len(evidence)
            ),
            "near1_marker_recall": ratio(
                sum(row[side][name]["near1_marker_hits"] for row in evidence), markers
            ),
            "near1_group_recall": ratio(
                sum(row[side][name]["near1_group_hits"] for row in evidence), groups
            ),
            "near1_questions_with_all_groups": ratio(
                sum(row[side][name]["near1_all_groups"] for row in evidence), len(evidence)
            ),
        }

    def average(key: str) -> float:
        return sum(float(row[key]) for row in selected) / len(selected)

    return {
        "questions": len(rows),
        "questions_with_gold_evidence": len(evidence),
        "mean_candidate_count": average("candidate_count"),
        "mean_read_count": average("read_count"),
        "mean_cited_count": average("cited_count"),
        "mean_search_call_count": average("search_call_count"),
        "mean_planned_query_count": average("planned_query_count"),
        "sufficient_count": sum(row["status"] == "sufficient" for row in selected),
        "stages": {name: stage(name) for name in ("candidate", "read", "cited")},
    }


def grouped(rows: list[dict[str, Any]], side: str, key: str) -> dict[str, Any]:
    values: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in rows:
        values[str(row[key])].append(row)
    return {name: summarize(group, side) for name, group in sorted(values.items())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=Path, required=True)
    parser.add_argument("--candidate-artifacts", type=Path, required=True)
    parser.add_argument("--baseline-artifacts", type=Path, required=True)
    parser.add_argument("--chunk-dir", type=Path, required=True)
    parser.add_argument("--ingest-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    requested = {
        row["request_fingerprint"]: row["request"] for row in read_jsonl(args.requests)
    }
    official_search = {
        request_fingerprint(row["request"]): row
        for row in read_jsonl(args.chunk_dir / "search_records.jsonl")
        if row["dataset"].startswith("beam_")
    }
    if not set(requested) <= set(official_search):
        raise SystemExit("request manifest is not a subset of official BEAM Search")
    candidate = artifact_map(args.candidate_artifacts, set(requested))
    baseline = artifact_map(args.baseline_artifacts, set(requested))
    if set(candidate) != set(requested) or set(baseline) != set(requested):
        raise SystemExit(
            f"artifact join mismatch: requests={len(requested)} "
            f"candidate={len(candidate)} baseline={len(baseline)}"
        )

    raw_questions = load_raw_questions(args.chunk_dir)
    session_counts = load_session_counts(args.ingest_manifest)
    answers = {
        item["qa_id"]: item
        for item in read_json(args.chunk_dir / "answer_output.json")
        if item["dataset"].startswith("beam_")
    }
    rows = []
    for fingerprint in requested:
        search = official_search[fingerprint]
        ident = search["qa_id"]
        dataset, remainder = ident.split(":", 1)
        sample_id = remainder.split("#", 1)[0]
        groups = evidence_groups(
            dataset,
            sample_id,
            [str(value) for value in raw_questions[ident].get("evidence", [])],
            session_counts,
        )
        rows.append(
            {
                "qa_id": ident,
                "dataset": dataset,
                "category": answers[ident]["category"],
                "expected_group_count": len(groups),
                "expected_marker_count": sum(len(group) for group in groups),
                "baseline": artifact_row(baseline[fingerprint], groups),
                "candidate": artifact_row(candidate[fingerprint], groups),
            }
        )

    abstention = [row for row in rows if row["category"] == "abstention"]
    report = {
        "protocol": {
            "retrieval_run_had_gold_access": False,
            "answer_calls": 0,
            "judge_calls": 0,
            "requests": len(rows),
        },
        "baseline": {
            "overall": summarize(rows, "baseline"),
            "by_dataset": grouped(rows, "baseline", "dataset"),
            "by_category": grouped(rows, "baseline", "category"),
            "abstention_sufficient": sum(
                row["baseline"]["status"] == "sufficient" for row in abstention
            ),
        },
        "candidate": {
            "overall": summarize(rows, "candidate"),
            "by_dataset": grouped(rows, "candidate", "dataset"),
            "by_category": grouped(rows, "candidate", "category"),
            "abstention_sufficient": sum(
                row["candidate"]["status"] == "sufficient" for row in abstention
            ),
        },
    }
    write_json(args.output, report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
