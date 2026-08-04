#!/usr/bin/env python3
"""Prepare and score raw-memory Top-30 Answer ablations without retrieval or gold leakage."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    path.chmod(0o600)


def sha256_json(value: Any) -> str:
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def exact_mcnemar_p(left_only: int, right_only: int) -> float:
    n = left_only + right_only
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, index) for index in range(0, min(left_only, right_only) + 1)) / (2 ** n)
    return min(1.0, 2 * tail)


def paired(left: dict[str, bool], right: dict[str, bool]) -> dict[str, Any]:
    if set(left) != set(right):
        raise ValueError("Paired result IDs do not match")
    both_correct = sum(left[key] and right[key] for key in left)
    left_only = sum(left[key] and not right[key] for key in left)
    right_only = sum(not left[key] and right[key] for key in left)
    both_wrong = len(left) - both_correct - left_only - right_only
    return {
        "count": len(left),
        "both_correct": both_correct,
        "left_correct_right_wrong": left_only,
        "left_wrong_right_correct": right_only,
        "both_wrong": both_wrong,
        "mcnemar_exact_p": exact_mcnemar_p(left_only, right_only),
    }


def prepare_longmemeval(args: argparse.Namespace) -> None:
    source = read_json(args.source)
    if source.get("gold_fields_present") is not False or source.get("original_answer_fields_present") is not False:
        raise ValueError("LongMemEval source must exclude gold and original answers")
    records = source.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("LongMemEval source has no records")
    prepared: list[dict[str, Any]] = []
    original_counts: list[int] = []
    selected_counts: list[int] = []
    for record in records:
        memories = record.get("searched_memories")
        if not isinstance(memories, list) or not memories:
            raise ValueError(f"Missing searched memories: {record.get('question_id')}")
        seen: set[str] = set()
        deduplicated: list[dict[str, Any]] = []
        for memory in memories:
            memory_id = memory.get("memoryId")
            content_hash = memory.get("contentHash")
            if not isinstance(memory_id, str) or not isinstance(content_hash, str):
                raise ValueError(f"Invalid immutable memory: {record.get('question_id')}")
            if memory_id in seen:
                continue
            seen.add(memory_id)
            deduplicated.append(memory)
        selected = deduplicated[: args.top_k]
        output = dict(record)
        output["searched_memories"] = selected
        output["searched_memory_count"] = len(selected)
        output["search_result_hash"] = sha256_json([
            {"memoryId": memory["memoryId"], "contentHash": memory["contentHash"]}
            for memory in selected
        ])
        prepared.append(output)
        original_counts.append(len(deduplicated))
        selected_counts.append(len(selected))
    payload = {
        "schema_version": 1,
        "created_from": str(args.source),
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "gold_fields_present": False,
        "original_answer_fields_present": False,
        "selection_data_present": False,
        "projection": "exact searched-memory order, immutable-ID deduplication, raw Top-K only",
        "top_k": args.top_k,
        "question_count": len(prepared),
        "original_memory_count": {
            "min": min(original_counts),
            "max": max(original_counts),
            "mean": sum(original_counts) / len(original_counts),
        },
        "selected_memory_count": {
            "min": min(selected_counts),
            "max": max(selected_counts),
            "mean": sum(selected_counts) / len(selected_counts),
        },
        "records": prepared,
    }
    write_json(args.output, payload)
    print(json.dumps({key: payload[key] for key in ("question_count", "top_k", "original_memory_count", "selected_memory_count")}, sort_keys=True))


def build_longmemeval_eval(args: argparse.Namespace) -> None:
    # Gold is deliberately introduced only here, after all Answer records exist.
    answers = read_json(args.answers).get("results")
    template = read_json(args.gold_template)
    if not isinstance(answers, list) or not isinstance(template, list):
        raise ValueError("Expected Answer results and evaluator template arrays")
    by_id = {row["question_id"]: row for row in answers}
    if len(by_id) != len(answers) or set(by_id) != {row["question_id"] for row in template}:
        raise ValueError("LongMemEval Answer/template identity mismatch")
    output = []
    for item in template:
        row = dict(item)
        row["response"] = by_id[item["question_id"]]["response"]
        output.append(row)
    write_json(args.output, output)
    print(json.dumps({"question_count": len(output), "gold_access": "post-answer evaluator construction"}, sort_keys=True))


def score_scriptmem(args: argparse.Namespace) -> None:
    predictions = {row["question_id"]: row for row in read_jsonl(args.predictions)}
    gold_score = read_json(args.gold_score)
    gold_rows = gold_score.get("rows")
    if not isinstance(gold_rows, list) or set(predictions) != {row["question_id"] for row in gold_rows}:
        raise ValueError("ScriptMem prediction/gold identity mismatch")
    rows: list[dict[str, Any]] = []
    groups: dict[str, list[bool]] = defaultdict(list)
    for gold in gold_rows:
        prediction = predictions[gold["question_id"]]
        labels = re.findall(r"\(([A-Z])\)", prediction.get("response", ""))
        correct = labels == gold["expected_labels"]
        row = {
            "question_id": gold["question_id"],
            "script": gold["script"],
            "qa_type": gold["qa_type"],
            "expected_labels": gold["expected_labels"],
            "predicted_labels": labels,
            "response": prediction.get("response", ""),
            "correct": correct,
        }
        rows.append(row)
        for key in ("overall", f"script:{gold['script']}", f"qa_type:{gold['qa_type']}"):
            groups[key].append(correct)
    summary = {
        key: {"correct": sum(values), "total": len(values), "accuracy": sum(values) / len(values)}
        for key, values in sorted(groups.items())
    }
    baseline = {row["question_id"]: bool(row["correct"]) for row in gold_rows}
    current = {row["question_id"]: bool(row["correct"]) for row in rows}
    result = {
        "schema_version": "pimem-scriptmem-raw-top30-score/v1",
        "benchmark": "ScriptMem-v19",
        "variant": "raw-retrieved-memories-top30",
        "summary": summary,
        "paired_against_agent_package_cited_raw": paired(baseline, current),
        "rows": rows,
    }
    write_json(args.output, result)
    print(json.dumps({"summary": summary, "paired": result["paired_against_agent_package_cited_raw"]}, sort_keys=True))


def compare_longmemeval(args: argparse.Namespace) -> None:
    def load(path: Path) -> tuple[dict[str, bool], dict[str, Any]]:
        value = read_json(path)
        rows = value.get("results")
        if not isinstance(rows, list):
            raise ValueError(f"Missing judge rows: {path}")
        return {row["question_id"]: bool(row["score"]) for row in rows}, value

    agent, _ = load(args.agent)
    raw_all, _ = load(args.raw_all)
    raw_top30, raw_top30_value = load(args.raw_top30)
    result = {
        "schema_version": "pimem-longmemeval-raw-top30-comparison/v1",
        "benchmark": "LongMemEval-S",
        "variants": {
            "agent_selection_package_plus_cited_raw": {"correct": sum(agent.values()), "total": len(agent), "accuracy": sum(agent.values()) / len(agent)},
            "raw_all_searched_memories": {"correct": sum(raw_all.values()), "total": len(raw_all), "accuracy": sum(raw_all.values()) / len(raw_all)},
            "raw_retrieved_memories_top30": {"correct": sum(raw_top30.values()), "total": len(raw_top30), "accuracy": sum(raw_top30.values()) / len(raw_top30)},
        },
        "paired": {
            "agent_vs_raw_top30": paired(agent, raw_top30),
            "raw_all_vs_raw_top30": paired(raw_all, raw_top30),
        },
        "raw_top30_judge_summary": raw_top30_value,
    }
    write_json(args.output, result)
    print(json.dumps({"variants": result["variants"], "paired": result["paired"]}, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    prepare = sub.add_parser("prepare-longmemeval")
    prepare.add_argument("--source", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--top-k", type=int, default=30)
    prepare.set_defaults(func=prepare_longmemeval)

    build_eval = sub.add_parser("build-longmemeval-eval")
    build_eval.add_argument("--answers", type=Path, required=True)
    build_eval.add_argument("--gold-template", type=Path, required=True)
    build_eval.add_argument("--output", type=Path, required=True)
    build_eval.set_defaults(func=build_longmemeval_eval)

    scriptmem = sub.add_parser("score-scriptmem")
    scriptmem.add_argument("--predictions", type=Path, required=True)
    scriptmem.add_argument("--gold-score", type=Path, required=True)
    scriptmem.add_argument("--output", type=Path, required=True)
    scriptmem.set_defaults(func=score_scriptmem)

    lme = sub.add_parser("compare-longmemeval")
    lme.add_argument("--agent", type=Path, required=True)
    lme.add_argument("--raw-all", type=Path, required=True)
    lme.add_argument("--raw-top30", type=Path, required=True)
    lme.add_argument("--output", type=Path, required=True)
    lme.set_defaults(func=compare_longmemeval)

    args = parser.parse_args()
    if getattr(args, "top_k", 1) <= 0:
        raise ValueError("--top-k must be positive")
    args.func(args)


if __name__ == "__main__":
    main()
