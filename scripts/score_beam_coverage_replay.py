#!/usr/bin/env python3
"""Score gold evidence coverage after a gold-blind coverage-candidate replay."""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path
from typing import Any

from analyze_beam_official_results import (
    evidence_groups,
    load_raw_questions,
    load_session_counts,
    read_json,
    read_jsonl,
    stage_metrics,
    write_json,
)


def request_fingerprint(request: dict[str, Any]) -> str:
    key = [
        str(request.get("query", "")),
        [str(value) for value in request.get("options", []) or []],
        str(request.get("user_id", "")),
        int(request.get("top_k", 0)),
    ]
    encoded = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    evidence_rows = [row for row in rows if row["expected_group_count"]]
    groups = sum(row["expected_group_count"] for row in evidence_rows)
    markers = sum(row["expected_marker_count"] for row in evidence_rows)

    def ratio(numerator: int, denominator: int) -> float | None:
        return numerator / denominator if denominator else None

    def stage(name: str) -> dict[str, Any]:
        return {
            "marker_recall": ratio(
                sum(row[name]["marker_hits"] for row in evidence_rows), markers
            ),
            "group_recall": ratio(
                sum(row[name]["group_hits"] for row in evidence_rows), groups
            ),
            "questions_with_all_groups": ratio(
                sum(row[name]["all_groups"] for row in evidence_rows),
                len(evidence_rows),
            ),
            "near1_marker_recall": ratio(
                sum(row[name]["near1_marker_hits"] for row in evidence_rows),
                markers,
            ),
            "near1_group_recall": ratio(
                sum(row[name]["near1_group_hits"] for row in evidence_rows),
                groups,
            ),
            "near1_questions_with_all_groups": ratio(
                sum(row[name]["near1_all_groups"] for row in evidence_rows),
                len(evidence_rows),
            ),
        }

    return {
        "questions": len(rows),
        "questions_with_gold_evidence": len(evidence_rows),
        "expected_group_count": groups,
        "expected_marker_count": markers,
        "mean_original_candidate_count": sum(
            row["original_candidate_count"] for row in rows
        ) / len(rows),
        "mean_replay_candidate_count": sum(
            row["replay_candidate_count"] for row in rows
        ) / len(rows),
        "original": stage("original"),
        "replay": stage("replay"),
    }


def grouped(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    values: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in rows:
        values[str(row[key])].append(row)
    return {name: summarize(group) for name, group in sorted(values.items())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--chunk-dir", type=Path, required=True)
    parser.add_argument("--ingest-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    replay = {row["request_fingerprint"]: row for row in read_jsonl(args.replay)}
    if len(replay) != 600:
        raise SystemExit(f"expected 600 replay rows, got {len(replay)}")
    official_search = {
        request_fingerprint(row["request"]): row
        for row in read_jsonl(args.chunk_dir / "search_records.jsonl")
        if row["dataset"].startswith("beam_")
    }
    if set(replay) != set(official_search):
        raise SystemExit("coverage replay and official BEAM request fingerprints differ")

    answer_output = {
        item["qa_id"]: item
        for item in read_json(args.chunk_dir / "answer_output.json")
        if item["dataset"].startswith("beam_")
    }
    raw_questions = load_raw_questions(args.chunk_dir)
    session_counts = load_session_counts(args.ingest_manifest)
    rows: list[dict[str, Any]] = []
    for fingerprint, replay_row in replay.items():
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
                "category": answer_output[ident]["category"],
                "coverage_call_count": int(replay_row["coverage_call_count"]),
                "original_candidate_count": int(replay_row["original_candidate_count"]),
                "replay_candidate_count": int(replay_row["replay_candidate_count"]),
                "expected_group_count": len(groups),
                "expected_marker_count": sum(len(group) for group in groups),
                "original": stage_metrics(groups, set(replay_row["original_markers"])),
                "replay": stage_metrics(groups, set(replay_row["replay_markers"])),
            }
        )

    report = {
        "protocol": {
            "retrieval_inputs": "original Agent Search traces only; no gold, rubrics, answers, or scores",
            "changed_component": "coverage candidate selection",
            "answer_calls": 0,
            "judge_calls": 0,
        },
        "overall": summarize(rows),
        "by_dataset": grouped(rows, "dataset"),
        "by_category": grouped(rows, "category"),
    }
    write_json(args.output, report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
