#!/usr/bin/env python3
"""Offline PersonaMem-v2 retrieval/projection attribution over sealed PiMem artifacts.

Gold fields are read only after the already-completed Search artifacts are loaded.
The script never calls Add, Search, Answer, Judge, or a model provider.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import statistics
from pathlib import Path
from typing import Any, Iterable

DATASET = "personamem_v2_32k"
PREFIX_RE = re.compile(
    r"^\s*\[personamem[^\]]*\]\[session_[^\]]+\]\[D\d+:\d+\]\[text\]\s*"
    r"(?:User|Assistant|System):\s*",
    flags=re.IGNORECASE,
)
SPACE_RE = re.compile(r"\s+")


def normalize_text(value: Any) -> str:
    text = str(value or "").replace("\u2019", "'").replace("\u2018", "'")
    text = PREFIX_RE.sub("", text)
    return SPACE_RE.sub(" ", text).strip().casefold()


def mean(values: Iterable[float]) -> float | None:
    rows = list(values)
    return statistics.mean(rows) if rows else None


def pct(numerator: int | float, denominator: int | float) -> float | None:
    return numerator / denominator if denominator else None


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def memory_rows(artifact: dict[str, Any], stage: str) -> list[dict[str, Any]]:
    memory = artifact["agent"]["memory"]
    if stage == "candidate":
        return list(memory.get("searched_memories", []))
    if stage == "read":
        return list(memory.get("read_evidence", []))
    if stage == "cited":
        citations = artifact["agent"]["selection"].get("citations", [])
        by_id: dict[str, dict[str, Any]] = {}
        for row in memory.get("searched_memories", []) + memory.get("read_evidence", []):
            by_id[str(row.get("memoryId"))] = row
        return [by_id[str(row.get("memoryId"))] for row in citations if str(row.get("memoryId")) in by_id]
    if stage == "answer":
        return [
            {"memoryId": row.get("id"), "content": row.get("content", row.get("text", ""))}
            for row in memory.get("returned_items", [])
            if not str(row.get("id", "")).startswith("pimem-package-")
        ]
    raise ValueError(f"unknown stage: {stage}")


def evidence_coverage(gold: list[dict[str, Any]], memories: list[dict[str, Any]]) -> dict[str, Any]:
    memory_texts = [normalize_text(row.get("content", row.get("text", row.get("preview", "")))) for row in memories]
    matches: list[bool] = []
    for evidence in gold:
        target = normalize_text(evidence.get("content", ""))
        matches.append(bool(target) and any(target == text or (len(target) >= 80 and target in text) for text in memory_texts))
    matched = sum(matches)
    return {
        "gold_count": len(matches),
        "matched_count": matched,
        "recall": pct(matched, len(matches)),
        "any": matched > 0,
        "complete": matched == len(matches) if matches else True,
        "memory_count": len(memories),
    }


def aggregate(rows: list[dict[str, Any]], stage: str) -> dict[str, Any]:
    cov = [row["coverage"][stage] for row in rows]
    gold_total = sum(item["gold_count"] for item in cov)
    matched_total = sum(item["matched_count"] for item in cov)
    return {
        "mean_memory_count": mean(item["memory_count"] for item in cov),
        "gold_message_recall": pct(matched_total, gold_total),
        "questions_with_any_gold": pct(sum(item["any"] for item in cov), len(cov)),
        "questions_with_complete_gold": pct(sum(item["complete"] for item in cov), len(cov)),
    }


def summarize_group(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "count": len(rows),
        "accuracy": mean(row["correct"] for row in rows),
        "mean_candidate_count": mean(row["candidate_count"] for row in rows),
        "mean_read_count": mean(row["read_count"] for row in rows),
        "mean_cited_count": mean(row["cited_count"] for row in rows),
        "mean_answer_raw_memory_count": mean(row["answer_raw_memory_count"] for row in rows),
        "mean_answer_memory_chars": mean(row["answer_memory_chars"] for row in rows),
        "candidate_complete": pct(sum(row["coverage"]["candidate"]["complete"] for row in rows), len(rows)),
        "read_complete": pct(sum(row["coverage"]["read"]["complete"] for row in rows), len(rows)),
        "cited_complete": pct(sum(row["coverage"]["cited"]["complete"] for row in rows), len(rows)),
    }


def context_bucket(count: int) -> str:
    if count <= 2:
        return "0-2"
    if count <= 4:
        return "3-4"
    if count <= 6:
        return "5-6"
    return "7+"


def render_markdown(report: dict[str, Any]) -> str:
    overall = report["overall"]
    lines = [
        "# PersonaMem-v2 32k PiMem Attribution",
        "",
        "This is a post-retrieval, gold-isolated analysis of the sealed Leaderboard v2 run. No provider calls were made.",
        "",
        "## Overall",
        "",
        f"- Questions: {overall['count']}",
        f"- Official accuracy: {overall['accuracy']:.2%}",
        f"- Mean Candidate / Read / Cited: {overall['mean_candidate_count']:.2f} / {overall['mean_read_count']:.2f} / {overall['mean_cited_count']:.2f}",
        f"- Mean raw memories visible to Answer: {overall['mean_answer_raw_memory_count']:.2f}",
        f"- Mean Answer memory characters: {overall['mean_answer_memory_chars']:.0f}",
        "",
        "## Gold evidence attrition",
        "",
        "| Stage | Mean memories | Gold-message recall | Any-gold questions | Complete-gold questions |",
        "|---|---:|---:|---:|---:|",
    ]
    for stage in ("candidate", "read", "cited", "answer"):
        item = report["stages"][stage]
        lines.append(
            f"| {stage.title()} | {item['mean_memory_count']:.2f} | {item['gold_message_recall']:.2%} | "
            f"{item['questions_with_any_gold']:.2%} | {item['questions_with_complete_gold']:.2%} |"
        )
    lines.extend([
        "",
        "## Wrong-answer attribution",
        "",
        "| Earliest observable failure | Wrong questions | Share of all wrong |",
        "|---|---:|---:|",
    ])
    wrong_total = report["wrong_answer_attribution"]["wrong_total"]
    for name, count in report["wrong_answer_attribution"]["buckets"].items():
        lines.append(f"| {name} | {count} | {count / wrong_total:.2%} |")
    lines.extend([
        "",
        "## Accuracy by Answer context size",
        "",
        "This table is correlational because context size is selected by the Retrieval Agent.",
        "",
        "| Raw memories | Questions | Accuracy | Mean candidate count |",
        "|---|---:|---:|---:|",
    ])
    for bucket, item in report["by_answer_context_count"].items():
        lines.append(f"| {bucket} | {item['count']} | {item['accuracy']:.2%} | {item['mean_candidate_count']:.2f} |")
    lines.extend([
        "",
        "## Accuracy by PersonaMem category",
        "",
        "| Category | Questions | Accuracy | Candidate complete | Cited complete | Mean cited |",
        "|---|---:|---:|---:|---:|---:|",
    ])
    for category, item in report["by_category"].items():
        lines.append(
            f"| {category} | {item['count']} | {item['accuracy']:.2%} | {item['candidate_complete']:.2%} | "
            f"{item['cited_complete']:.2%} | {item['mean_cited_count']:.2f} |"
        )
    lines.extend([
        "",
        "## Interpretation boundary",
        "",
        "- Candidate-complete but Cited-incomplete wrong answers are recoverable candidates for a final global evidence projector.",
        "- Cited-complete wrong answers are Answer/prompt/reasoning failures rather than retrieval misses under the exact-evidence diagnostic.",
        "- PersonaMem includes anti-stereotypical, forgetting, and sensitive-information categories; more context can hurt unless the final selector understands whether personalization is permitted.",
        "- Exact gold-message matching is intentionally strict and is used only offline.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--chunk-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    # Load immutable, already-completed Search artifacts before any gold source.
    artifacts: dict[tuple[str, str], dict[str, Any]] = {}
    for path in sorted(args.artifact_dir.glob("*.json")):
        artifact = load_json(path)
        search = artifact.get("search", {})
        user_id = str(search.get("user_id", ""))
        marker = f":{DATASET}:"
        if marker not in user_id:
            continue
        sample_id = user_id.split(marker, 1)[1]
        artifacts[(sample_id, normalize_text(search.get("query", "").split("\n\nA.", 1)[0]))] = artifact

    raw = load_json(args.chunk_dir / "scriptmem_raw_for_eval" / f"{DATASET}.json")
    answer_inputs = {
        row["qa_id"]: row for row in load_json(args.chunk_dir / "answer_input.json") if row.get("dataset") == DATASET
    }
    details = {
        row["qa_id"]: row for row in load_json(args.chunk_dir / "official_details.json") if row.get("dataset") == DATASET
    }

    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    for sample in raw:
        sample_id = sample["sample_id"]
        for qa_index, qa in enumerate(sample["qa"]):
            qa_id = f"{DATASET}:{sample_id}#q{qa_index:04d}"
            artifact = artifacts.get((sample_id, normalize_text(qa["question"])))
            if artifact is None or qa_id not in details or qa_id not in answer_inputs:
                missing.append(qa_id)
                continue
            ai = answer_inputs[qa_id]
            coverage = {
                stage: evidence_coverage(qa.get("evidence", []), memory_rows(artifact, stage))
                for stage in ("candidate", "read", "cited", "answer")
            }
            metrics = artifact["agent"]["metrics"]
            validation = ai["speaker_a_retrieval"].get("metadata", {}).get("validation", {})
            row = {
                "qa_id": qa_id,
                "sample_id": sample_id,
                "question": qa["question"],
                "category": qa.get("category", "unknown"),
                "who": qa.get("who"),
                "updated": bool(qa.get("updated")),
                "sensitive_info": bool(qa.get("sensitive_info")),
                "gold": details[qa_id].get("gold", []),
                "predicted": details[qa_id].get("predicted", []),
                "correct": float(details[qa_id].get("score", 0.0)),
                "candidate_count": int(metrics["candidateCount"]),
                "read_count": int(metrics["evidenceCount"]),
                "cited_count": int(metrics["citedCount"]),
                "answer_raw_memory_count": len(memory_rows(artifact, "answer")),
                "answer_memory_chars": int(validation.get("total_memory_chars", 0)),
                "selection_status": artifact["agent"]["selection"].get("status"),
                "coverage": coverage,
            }
            rows.append(row)

    if missing:
        raise RuntimeError(f"missing joins: {len(missing)}; examples={missing[:5]}")
    if len(rows) != 600 or len(artifacts) != 600:
        raise RuntimeError(f"expected 600 joined PersonaMem questions, got rows={len(rows)} artifacts={len(artifacts)}")

    wrong = [row for row in rows if not row["correct"]]
    failure_buckets: collections.Counter[str] = collections.Counter()
    for row in wrong:
        cov = row["coverage"]
        if not cov["candidate"]["complete"]:
            failure_buckets["Candidate missing exact gold evidence"] += 1
        elif not cov["read"]["complete"]:
            failure_buckets["Candidate complete, Read incomplete"] += 1
        elif not cov["cited"]["complete"]:
            failure_buckets["Read complete, Citation/Answer projection incomplete"] += 1
        else:
            failure_buckets["Cited complete, Answer still wrong"] += 1

    category_groups: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    context_groups: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in rows:
        category_groups[row["category"]].append(row)
        context_groups[context_bucket(row["answer_raw_memory_count"])].append(row)

    overall = summarize_group(rows)
    report = {
        "schema_version": "pimem-personamem-attribution-v1",
        "dataset": DATASET,
        "gold_isolation": "Gold loaded only after sealed Search artifacts; no provider calls.",
        "overall": overall,
        "stages": {stage: aggregate(rows, stage) for stage in ("candidate", "read", "cited", "answer")},
        "wrong_answer_attribution": {
            "wrong_total": len(wrong),
            "buckets": dict(sorted(failure_buckets.items())),
            "candidate_complete_but_cited_incomplete": sum(
                row["coverage"]["candidate"]["complete"] and not row["coverage"]["cited"]["complete"]
                for row in wrong
            ),
        },
        "by_answer_context_count": {
            bucket: summarize_group(context_groups[bucket]) for bucket in ("0-2", "3-4", "5-6", "7+") if context_groups[bucket]
        },
        "by_category": {name: summarize_group(group) for name, group in sorted(category_groups.items())},
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "PERSONAMEM_ATTRIBUTION.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    (args.output_dir / "PERSONAMEM_ATTRIBUTION.md").write_text(render_markdown(report), encoding="utf-8")
    with (args.output_dir / "personamem_cases.jsonl").open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
