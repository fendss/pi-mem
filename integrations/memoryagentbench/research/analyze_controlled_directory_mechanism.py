#!/usr/bin/env python3
"""Measure how the controlled V3 Agent used the first compact directory.

This is a read-only post-hoc analysis.  It joins only the 84 frozen regression
IDs and treats the first successful semantic ``search`` as the initial
observation.  A directory candidate counts as directly read only when its
stable C reference appears in a later ``read(candidateRefs=...)`` call; merely
being returned as a context neighbour does not count.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any


DEFAULT_ROOT = Path(os.environ.get("PIMEM_EVAL_ROOT", "artifacts")) / (
    "lme300-controlled-regression-20260830"
)


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number} must be a JSON object")
            yield value


def by_query_id(rows: Iterable[dict[str, Any]], source: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        query_id = row.get("benchmark_query_id")
        if not isinstance(query_id, str) or not query_id:
            raise ValueError(f"{source}: row has no benchmark_query_id")
        if query_id in result:
            raise ValueError(f"{source}: duplicate query {query_id}")
        result[query_id] = row
    return result


def wrap_query_id(row: dict[str, Any]) -> str | None:
    for value in (
        row.get("operatorExperiment"),
        (row.get("retrieval") or {}).get("operatorExperiment"),
    ):
        if isinstance(value, dict) and isinstance(value.get("questionId"), str):
            return value["questionId"]
    return None


def wrap_by_query_id(
    rows: Iterable[dict[str, Any]], source: Path
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        query_id = wrap_query_id(row)
        if not query_id:
            raise ValueError(f"{source}: wrap row has no operator questionId")
        if query_id in result:
            raise ValueError(f"{source}: duplicate query {query_id}")
        result[query_id] = row
    return result


def reference_map(value: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, dict):
            continue
        candidate_ref = item.get("candidateRef")
        memory_id = item.get("memoryId")
        if isinstance(candidate_ref, str) and isinstance(memory_id, str):
            result[candidate_ref] = memory_id
    return result


def requested_candidate_refs(call: dict[str, Any]) -> set[str]:
    arguments = call.get("arguments") or call.get("args") or {}
    if not isinstance(arguments, dict):
        return set()
    value = arguments.get("candidateRefs")
    if not isinstance(value, list):
        return set()
    return {item for item in value if isinstance(item, str)}


def group_hits(memory_ids: set[str], gold_groups: list[set[str]]) -> int:
    return sum(bool(memory_ids & group) for group in gold_groups)


def mechanism_record(
    wrap: dict[str, Any], target: dict[str, Any]
) -> dict[str, Any]:
    retrieval = wrap.get("retrieval") or {}
    trace = retrieval.get("trace") or []
    if not isinstance(trace, list):
        trace = []
    searches = [
        (index, call)
        for index, call in enumerate(trace)
        if isinstance(call, dict)
        and call.get("toolName") == "search"
        and call.get("isError") is not True
    ]
    if not searches:
        raise ValueError(
            f"{target['benchmark_query_id']}: no successful semantic search"
        )
    first_index, first_search = searches[0]
    first_details = first_search.get("details") or {}
    if not isinstance(first_details, dict):
        first_details = {}
    full = reference_map(first_details.get("candidateReferences"))
    directory = reference_map(first_details.get("directoryCandidateReferences"))
    overlap = set(full) & set(directory)
    if overlap:
        raise ValueError(
            f"{target['benchmark_query_id']}: initial full/directory refs overlap: "
            f"{sorted(overlap)}"
        )

    second_search_index = searches[1][0] if len(searches) > 1 else len(trace)
    all_read_refs: set[str] = set()
    immediate_read_refs: set[str] = set()
    for index, call in enumerate(trace):
        if (
            not isinstance(call, dict)
            or call.get("toolName") != "read"
            or call.get("isError") is True
        ):
            continue
        refs = requested_candidate_refs(call)
        all_read_refs.update(refs)
        if first_index < index < second_search_index:
            immediate_read_refs.update(refs)

    selected = {
        memory_id
        for memory_id in (wrap.get("selectedMemoryIds") or [])
        if isinstance(memory_id, str)
    }
    gold_groups = [
        {memory_id for memory_id in group if isinstance(memory_id, str)}
        for group in (target.get("gold_source_groups") or [])
        if isinstance(group, list)
    ]
    full_memories = set(full.values())
    directory_memories = set(directory.values())
    read_directory_refs = all_read_refs & set(directory)
    immediate_directory_refs = immediate_read_refs & set(directory)
    selected_directory = selected & directory_memories

    return {
        "initial_full_count": len(full),
        "initial_directory_count": len(directory),
        "initial_full_gold_group_count": group_hits(full_memories, gold_groups),
        "initial_directory_gold_group_count": group_hits(
            directory_memories, gold_groups
        ),
        "gold_group_count": len(gold_groups),
        "read_initial_directory": bool(read_directory_refs),
        "read_initial_directory_before_second_search": bool(
            immediate_directory_refs
        ),
        "read_initial_directory_refs": sorted(read_directory_refs),
        "selected_initial_directory": bool(selected_directory),
        "selected_initial_directory_count": len(selected_directory),
        "selected_initial_directory_gold_group_count": group_hits(
            selected_directory, gold_groups
        ),
    }


def count_flags(rows: list[dict[str, Any]]) -> dict[str, int]:
    keys = (
        "read_initial_directory",
        "read_initial_directory_before_second_search",
        "selected_initial_directory",
    )
    result = {key: sum(bool(row["mechanism"][key]) for row in rows) for key in keys}
    result["initial_directory_has_gold"] = sum(
        row["mechanism"]["initial_directory_gold_group_count"] > 0 for row in rows
    )
    result["selected_initial_directory_gold"] = sum(
        row["mechanism"]["selected_initial_directory_gold_group_count"] > 0
        for row in rows
    )
    return result


def render_markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Controlled V3 initial-directory mechanism",
        "",
        (
            "Scope: the frozen 84 IDs. `Initial directory` means the compact C "
            "references returned by the first successful semantic search."
        ),
        "",
        "| Paired stratum | N | Read initial directory | Read before second search | Commit directory memory | Directory contains gold | Commit directory gold |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for stratum in ("all", "v3_only", "v1_only", "both_correct", "both_wrong"):
        summary = result["strata"][stratum]
        flags = summary["counts"]
        lines.append(
            f"| {stratum} | {summary['n']} | "
            f"{flags['read_initial_directory']} | "
            f"{flags['read_initial_directory_before_second_search']} | "
            f"{flags['selected_initial_directory']} | "
            f"{flags['initial_directory_has_gold']} | "
            f"{flags['selected_initial_directory_gold']} |"
        )
    lines.extend(
        [
            "",
            "## V3-only rows",
            "",
            "| Query | Type | Stage | Read directory | Immediate read | Directory gold groups | Committed directory gold groups |",
            "|---|---|---|---:|---:|---:|---:|",
        ]
    )
    for row in result["strata"]["v3_only"]["rows"]:
        mechanism = row["mechanism"]
        lines.append(
            f"| `{row['benchmark_query_id']}` | {row['question_type']} | "
            f"{row['pipeline_stage']} | "
            f"{int(mechanism['read_initial_directory'])} | "
            f"{int(mechanism['read_initial_directory_before_second_search'])} | "
            f"{mechanism['initial_directory_gold_group_count']} | "
            f"{mechanism['selected_initial_directory_gold_group_count']} |"
        )
    lines.extend(
        [
            "",
            "This report measures trace usage, not causality. A paired gain that "
            "does not commit a directory gold item may be search/selection/answer "
            "variance in the single controlled run.",
            "",
        ]
    )
    return "\n".join(lines)


def build_result(root: Path) -> dict[str, Any]:
    manifest_path = root / "artifacts/regression-84-manifest.json"
    v1_judge_path = (
        root / "evaluation/gpt4o-official-guard84/longmemeval-s-static.json"
    )
    v3_judge_path = (
        root
        / "evaluation/gpt4o-official-guard84-directory-v3/longmemeval-s-static.json"
    )
    v3_wrap_path = (
        root / "runtime-snapshot-directory-v3/memory-service/wrap-audits.jsonl"
    )

    manifest = read_json(manifest_path)
    targets = manifest.get("targets")
    if not isinstance(targets, list):
        raise ValueError(f"{manifest_path}: targets must be a list")
    target_map = by_query_id(targets, manifest_path)
    v1_judge = by_query_id(read_json(v1_judge_path).get("data") or [], v1_judge_path)
    v3_judge = by_query_id(read_json(v3_judge_path).get("data") or [], v3_judge_path)
    v3_wrap = wrap_by_query_id(read_jsonl(v3_wrap_path), v3_wrap_path)

    target_ids = set(target_map)
    for name, rows in (("V1 judge", v1_judge), ("V3 judge", v3_judge), ("V3 wrap", v3_wrap)):
        missing = target_ids - set(rows)
        if missing:
            raise ValueError(f"{name} is missing {len(missing)} target rows")

    rows: list[dict[str, Any]] = []
    for query_id in sorted(target_ids):
        v1_correct = v1_judge[query_id].get("label")
        v3_correct = v3_judge[query_id].get("label")
        if not isinstance(v1_correct, bool) or not isinstance(v3_correct, bool):
            raise ValueError(f"{query_id}: judge labels must be boolean")
        target = target_map[query_id]
        rows.append(
            {
                "benchmark_query_id": query_id,
                "question_type": target.get("question_type"),
                "pipeline_stage": target.get("pipeline_stage"),
                "v1_correct": v1_correct,
                "v3_correct": v3_correct,
                "mechanism": mechanism_record(v3_wrap[query_id], target),
            }
        )

    predicates = {
        "all": lambda row: True,
        "v3_only": lambda row: row["v3_correct"] and not row["v1_correct"],
        "v1_only": lambda row: row["v1_correct"] and not row["v3_correct"],
        "both_correct": lambda row: row["v1_correct"] and row["v3_correct"],
        "both_wrong": lambda row: not row["v1_correct"] and not row["v3_correct"],
    }
    strata: dict[str, Any] = {}
    for name, predicate in predicates.items():
        selected_rows = [row for row in rows if predicate(row)]
        strata[name] = {
            "n": len(selected_rows),
            "counts": count_flags(selected_rows),
            "rows": selected_rows,
        }
    return {
        "schema_version": 1,
        "scope": "frozen controlled-regression 84 IDs",
        "definition": {
            "initial_observation": "first successful semantic search",
            "direct_read": "read(candidateRefs) explicitly names an initial directory C ref",
            "immediate_read": "direct read occurs before the second successful semantic search",
            "gold_source": "post-hoc manifest gold_source_groups; never shown to the Agent",
        },
        "strata": strata,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = build_result(args.root)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "controlled-v3-directory-mechanism.json"
    markdown_path = args.output_dir / "controlled-v3-directory-mechanism.md"
    json_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(render_markdown(result), encoding="utf-8")
    print(
        json.dumps(
            {
                "json": str(json_path),
                "markdown": str(markdown_path),
                "all": result["strata"]["all"]["counts"],
                "v3_only": result["strata"]["v3_only"]["counts"],
                "v1_only": result["strata"]["v1_only"]["counts"],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
