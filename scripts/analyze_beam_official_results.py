#!/usr/bin/env python3
"""Adapt PiMem Search outputs to the fixed BEAM pipeline and analyze failures.

This script is deliberately offline: it does not call an answer or judge model.
It reconstructs the exact BEAM answer/judge prompts, joins official answers and
scores to private PiMem Search artifacts, and measures evidence attrition at the
candidate, read, and cited-output boundaries.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sqlite3
import statistics
from pathlib import Path
from typing import Any, Callable, Iterable


# Verbatim upstream BEAM prompt used by the official benchmark pipeline.
ANSWER_GENERATION_FOR_RAG = """
You are an assistant that MUST answer questions using ONLY the information provided in the context below. 

STRICT INSTRUCTIONS:
1. Answer ONLY based on the provided context
2. Do NOT use your internal knowledge

CONTEXT:
<context>

QUESTION:
<question>

ANSWER REQUIREMENTS:
- Be direct and concise
- Only output the answer to the question without any explanation 

RESPONSE:
"""


# Verbatim upstream BEAM rubric prompt used by the official benchmark pipeline.
UNIFIED_LLM_JUDGE_BASE_PROMPT = """
You are an expert evaluator tasked with judging whether the LLM's response demonstrates compliance with the specified RUBRIC CRITERION.

## EVALUATION INPUTS
- QUESTION (what the user asked): <question>
- RUBRIC CRITERION (what to check): <rubric_item>
- RESPONSE TO EVALUATE: <llm_response>

## EVALUATION RUBRIC:
The rubric defines a specific requirement, constraint, or expected behavior that the LLM response should demonstrate. 

**IMPORTANT**: Pay careful attention to whether the rubric specifies:
- **Positive requirements** (things the response SHOULD include/do)
- **Negative constraints** (things the response SHOULD NOT include/do, often indicated by "no", "not", "avoid", "absent")

## RESPONSIVENESS REQUIREMENT (anchored to the QUESTION)
A compliant response must be **on-topic with respect to the QUESTION** and attempt to answer it.
- If the response does not address the QUESTION, score **0.0** and stop.
- For negative constraints, both must hold: (a) the response is responsive to the QUESTION, and (b) the prohibited element is absent.

## SEMANTIC TOLERANCE RULES:
Judge by meaning, not exact wording.
- Accept **paraphrases** and **synonyms** that preserve intent.
- **Case/punctuation/whitespace** differences must be ignored.
- **Numbers/currencies/dates** may appear in equivalent forms (e.g., “$68,000”, “68k”, “68,000 USD”, or “sixty-eight thousand dollars”). Treat them as equal when numerically equivalent.
- If the rubric expects a number or duration, prefer **normalized comparison** (extract and compare values) over string matching.

## STYLE NEUTRALITY (prevents style contamination):
Ignore tone, politeness, length, and flourish unless the rubric explicitly requires a format/structure (e.g., “itemized list”, “no citations”, “one sentence”).
- Do **not** penalize hedging, voice, or verbosity if content satisfies the rubric.
- Only evaluate format when the rubric **explicitly** mandates it.

## SCORING SCALE:
- **1.0 (Complete Compliance)**: Fully complies with the rubric criterion.
  - Positive: required element present, accurate, properly executed (allowing semantic equivalents).
  - Negative: prohibited element **absent** AND response is **responsive**.
  
- **0.5 (Partial Compliance)**: Partially complies.
  - Positive: element present but minor inaccuracies/incomplete execution.
  - Negative: generally responsive and mostly avoids the prohibited element but with minor/edge violations.
  
- **0.0 (No Compliance)**: Fails to comply.
  - Positive: required element missing or incorrect.
  - Negative: prohibited element present **or** response is non-responsive/evasive even if the element is absent.

## EVALUATION INSTRUCTIONS:
1. **Understand the Requirement**: Determine if the rubric is asking for something to be present (positive) or absent (negative/constraint).

2. **Parse Compound Statements**: If the rubric contains multiple elements connected by "and" or commas, evaluate whether:
   - **All elements** must be present for full compliance (1.0)
   - **Some elements** present indicates partial compliance (0.5)
   - **No elements** present indicates no compliance (0.0)
   
3. **Check Compliance**: 
   - For positive requirements: Look for the presence and quality of the required element
   - For negative constraints: Look for the absence of the prohibited element

4. **Assign Score**: Based on compliance with the specific rubric criterion according to the scoring scale above.

5. **Provide Reasoning**: Explain whether the rubric criterion was satisfied and justify the score.

## OUTPUT FORMAT:
Return your evaluation in JSON format with two fields:

{
   "score": [your score: 1.0, 0.5, or 0.0],
   "reason": "[detailed explanation of whether the rubric criterion was satisfied and why this justified the assigned score]"
}

NOTE: ONLY output the json object, without any explanation before or after that
"""


BATCH_OUTPUT_FORMAT = """## OUTPUT FORMAT:
Return one independent evaluation for every indexed rubric criterion in JSON:

{
  "scores": [
    {"index": 0, "score": 1.0, "reason": "detailed justification"}
  ]
}

Include every index exactly once. Each score must be 1.0, 0.5, or 0.0.
NOTE: ONLY output the json object, without any explanation before or after that
"""

ANSWER_PROMPT_SHA256 = "ed89b98d1024432a46bd297345961cf89d2429746daec37befb50db46e0c914a"
JUDGE_PROMPT_SHA256 = "d349c9a8559bed9c14bfe2e624212225b09218ff864258a739229c15f4c8e869"
PACKAGE_TYPE = "pimem_evidence_package_v1"
MARKER_RE = re.compile(r"\[(D\d+:\d+)\]\[text\]")
DIRECT_EVIDENCE_RE = re.compile(r"D(\d+):(\d+)", re.IGNORECASE)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(text(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value or "")


def context_text(item: dict[str, Any]) -> str:
    for key in ("context", "retrieved_context", "memories"):
        if key in item:
            return text(item[key])
    speaker_sections = []
    for number in (1, 2):
        key = f"speaker_{number}_memories"
        if key in item:
            name = text(item.get(f"speaker_{number}_name", f"speaker {number}"))
            speaker_sections.append(f"Memories for user {name}:\n{text(item[key])}")
    if speaker_sections:
        return "\n\n".join(speaker_sections)
    raise ValueError(f"record {item.get('id', '<unknown>')} has no context or memories")


def render_answer_prompt(item: dict[str, Any]) -> str:
    values = {"context": context_text(item), "question": text(item["question"])}
    return re.sub(
        r"<(context|question)>",
        lambda match: values[match.group(1)],
        ANSWER_GENERATION_FOR_RAG,
    )


def render_batch_judge_prompt(question: str, response: str, rubrics: list[str]) -> str:
    criteria = "\n".join(f"[{index}] {rubric}" for index, rubric in enumerate(rubrics))
    prompt = (
        UNIFIED_LLM_JUDGE_BASE_PROMPT.replace("<question>", question)
        .replace("<rubric_item>", criteria)
        .replace("<llm_response>", response)
    )
    prompt = prompt[: prompt.index("## OUTPUT FORMAT:")] + BATCH_OUTPUT_FORMAT
    return (
        "Evaluate every indexed RUBRIC CRITERION independently. Apply the complete protocol "
        "below separately to each criterion; do not let one criterion affect another.\n\n"
        + prompt
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"{path} contains a non-object JSONL row")
                yield value


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def write_jsonl(path: Path, values: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for value in values:
            handle.write(json.dumps(value, ensure_ascii=False) + "\n")
    path.chmod(0o600)


def request_key(value: dict[str, Any]) -> tuple[str, tuple[str, ...], str, int]:
    return (
        str(value.get("query", "")),
        tuple(str(option) for option in value.get("options", []) or []),
        str(value.get("user_id", "")),
        int(value.get("top_k", 0)),
    )


def search_plan_stats(trace: list[dict[str, Any]]) -> dict[str, Any]:
    operators: list[str] = []
    query_count = 0
    for event in trace:
        if event.get("toolName") != "search":
            continue
        arguments = event.get("args") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {}
        details = event.get("details") or {}
        operator = arguments.get("operator") or details.get("operator") or "missing"
        operators.append(str(operator))
        query_count += len(arguments.get("queries") or [])
    return {
        "search_call_count": len(operators),
        "planned_query_count": query_count,
        "operators": operators,
        "first_operator": operators[0] if operators else "none",
    }


def parse_package(selected: list[dict[str, Any]]) -> dict[str, Any]:
    if not selected:
        return {}
    try:
        package = json.loads(selected[0]["text"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return {}
    return package if package.get("type") == PACKAGE_TYPE else {}


def selected_texts(item: dict[str, Any]) -> list[str]:
    selected = item["speaker_a_retrieval"]["selected"]
    if item["speaker_b_retrieval"]["selected"]:
        raise ValueError(f"BEAM record {item['qa_id']} unexpectedly has speaker-B results")
    return [str(memory["text"]) for memory in selected]


def load_raw_questions(chunk_dir: Path) -> dict[str, dict[str, Any]]:
    questions: dict[str, dict[str, Any]] = {}
    for dataset in ("beam_100k", "beam_1m"):
        records = read_json(chunk_dir / "scriptmem_raw_for_eval" / f"{dataset}.json")
        for record in records:
            for index, question in enumerate(record["qa"]):
                ident = f"{dataset}:{record['sample_id']}#q{index:04d}"
                if ident in questions:
                    raise ValueError(f"duplicate raw BEAM ID {ident}")
                questions[ident] = question
    return questions


def load_session_counts(ingest_manifest: Path) -> dict[tuple[str, str], list[int]]:
    sessions: dict[tuple[str, str], list[tuple[int, int]]] = collections.defaultdict(list)
    for dataset in read_json(ingest_manifest)["datasets"]:
        name = dataset["dataset"]
        if not name.startswith("beam_"):
            continue
        for session in dataset["sessions"]:
            match = re.search(r"\d+", session["session_key"])
            if not match:
                raise ValueError(f"invalid BEAM session key {session['session_key']}")
            sessions[(name, session["sample_id"])].append(
                (int(match.group()), int(session["message_count"]))
            )
    return {
        key: [count for _, count in sorted(values)]
        for key, values in sessions.items()
    }


def evidence_groups(
    dataset: str,
    sample_id: str,
    evidence: list[str],
    session_counts: dict[tuple[str, str], list[int]],
) -> list[list[str]]:
    counts = session_counts[(dataset, sample_id)]
    groups: list[list[str]] = []
    for raw_value in evidence:
        value = raw_value.strip()
        direct = DIRECT_EVIDENCE_RE.fullmatch(value)
        if direct:
            groups.append([f"D{int(direct.group(1))}:{int(direct.group(2))}"])
            continue
        decoded = json.loads(value)
        indexes = decoded if isinstance(decoded, list) else [decoded]
        markers: list[str] = []
        for raw_index in indexes:
            index = int(raw_index)
            prior = 0
            for session_index, count in enumerate(counts, 1):
                if index < prior + count:
                    # Upstream numeric chat IDs are zero-based. Persisted D labels are one-based.
                    markers.append(f"D{session_index}:{index - prior + 1}")
                    break
                prior += count
            else:
                raise ValueError(
                    f"evidence index {index} is outside {dataset}/{sample_id} session bounds"
                )
        groups.append(markers)
    return groups


def marker_set(memories: Iterable[dict[str, Any]], field: str = "content") -> set[str]:
    markers: set[str] = set()
    for memory in memories:
        markers.update(MARKER_RE.findall(str(memory[field])))
    return markers


def marker_near(expected: str, found: set[str], window: int = 1) -> bool:
    expected_match = DIRECT_EVIDENCE_RE.fullmatch(expected)
    if not expected_match:
        return False
    expected_session = int(expected_match.group(1))
    expected_turn = int(expected_match.group(2))
    for candidate in found:
        candidate_match = DIRECT_EVIDENCE_RE.fullmatch(candidate)
        if candidate_match and int(candidate_match.group(1)) == expected_session:
            if abs(int(candidate_match.group(2)) - expected_turn) <= window:
                return True
    return False


def stage_metrics(groups: list[list[str]], found: set[str]) -> dict[str, Any]:
    markers = [marker for group in groups for marker in group]
    exact_groups = [bool(set(group) & found) for group in groups]
    near_groups = [any(marker_near(marker, found) for marker in group) for group in groups]
    return {
        "marker_hits": sum(marker in found for marker in markers),
        "group_hits": sum(exact_groups),
        "all_groups": bool(groups) and all(exact_groups),
        "near1_marker_hits": sum(marker_near(marker, found) for marker in markers),
        "near1_group_hits": sum(near_groups),
        "near1_all_groups": bool(groups) and all(near_groups),
    }


def mean(rows: list[dict[str, Any]], key: str) -> float | None:
    return statistics.mean(float(row[key]) for row in rows) if rows else None


def rounded(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if value is not None else None


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    evidence_rows = [row for row in rows if row["expected_group_count"]]
    expected_groups = sum(row["expected_group_count"] for row in evidence_rows)
    expected_markers = sum(row["expected_marker_count"] for row in evidence_rows)
    stages = {}
    for stage in ("candidate", "read", "cited"):
        stages[stage] = {
            "marker_recall": rounded(
                sum(row[stage]["marker_hits"] for row in evidence_rows) / expected_markers
                if expected_markers
                else None
            ),
            "group_recall": rounded(
                sum(row[stage]["group_hits"] for row in evidence_rows) / expected_groups
                if expected_groups
                else None
            ),
            "questions_with_all_groups": rounded(
                sum(row[stage]["all_groups"] for row in evidence_rows) / len(evidence_rows)
                if evidence_rows
                else None
            ),
            "near1_marker_recall": rounded(
                sum(row[stage]["near1_marker_hits"] for row in evidence_rows) / expected_markers
                if expected_markers
                else None
            ),
            "near1_group_recall": rounded(
                sum(row[stage]["near1_group_hits"] for row in evidence_rows) / expected_groups
                if expected_groups
                else None
            ),
            "near1_questions_with_all_groups": rounded(
                sum(row[stage]["near1_all_groups"] for row in evidence_rows) / len(evidence_rows)
                if evidence_rows
                else None
            ),
        }
    return {
        "questions": len(rows),
        "questions_with_gold_evidence": len(evidence_rows),
        "mean_official_score": rounded(mean(rows, "official_score")),
        "strict_accuracy": rounded(mean(rows, "strict_accuracy")),
        "mean_candidate_count": rounded(mean(rows, "candidate_count")),
        "mean_read_count": rounded(mean(rows, "read_count")),
        "mean_cited_raw_count": rounded(mean(rows, "cited_raw_count")),
        "mean_search_call_count": rounded(mean(rows, "search_call_count")),
        "mean_planned_query_count": rounded(mean(rows, "planned_query_count")),
        "expected_group_count": expected_groups,
        "expected_marker_count": expected_markers,
        "stages": stages,
    }


def grouped_summary(
    rows: list[dict[str, Any]], key: str
) -> dict[str, dict[str, Any]]:
    values: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for row in rows:
        values[str(row[key])].append(row)
    return {name: summarize_rows(group) for name, group in sorted(values.items())}


def condition_summary(
    rows: list[dict[str, Any]], predicate: Callable[[dict[str, Any]], bool]
) -> dict[str, Any]:
    selected = [row for row in rows if predicate(row)]
    return {
        "questions": len(selected),
        "mean_official_score": rounded(mean(selected, "official_score")),
        "strict_accuracy": rounded(mean(selected, "strict_accuracy")),
    }


def markdown_report(report: dict[str, Any]) -> str:
    overall = report["overall"]
    lines = [
        "# BEAM Fixed-Pipeline Failure Analysis",
        "",
        "## Fixed boundary",
        "",
        f"- Answer model: `{report['pipeline']['answer_model']}` (run assertion)",
        f"- Answer prompt SHA-256: `{report['pipeline']['answer_prompt_sha256']}`",
        f"- Judge model: `{report['pipeline']['judge_model']}`",
        f"- Judge prompt SHA-256: `{report['pipeline']['judge_prompt_sha256']}`",
        f"- Questions: {overall['questions']}",
        f"- Mean official question score: {overall['mean_official_score']:.4f}",
        f"- Strict accuracy: {overall['strict_accuracy']:.4f}",
        "",
        "## Evidence attrition",
        "",
        "Gold evidence is mapped to persisted `D<session>:<turn>` markers. Near-1 also accepts the adjacent user/assistant turn.",
        "",
        "| Stage | Exact group recall | Near-1 group recall | Questions with all groups (near-1) |",
        "|---|---:|---:|---:|",
    ]
    for stage in ("candidate", "read", "cited"):
        value = overall["stages"][stage]
        lines.append(
            f"| {stage} | {value['group_recall']:.2%} | {value['near1_group_recall']:.2%} | "
            f"{value['near1_questions_with_all_groups']:.2%} |"
        )
    lines.extend(
        [
            "",
            "## Principal failure factors",
            "",
            f"1. **Candidate recall is the largest first loss.** Near-1 evidence-group recall starts at {overall['stages']['candidate']['near1_group_recall']:.2%}; the Agent averages only {overall['mean_search_call_count']:.2f} Search calls per question.",
            f"2. **Read/citation contraction removes additional relevant evidence.** It falls to {overall['stages']['read']['near1_group_recall']:.2%} after reads and {overall['stages']['cited']['near1_group_recall']:.2%} in Answer-visible raw memories.",
            f"3. **Abstention calibration is poor.** {report['abstention']['sufficient_questions']} of {report['abstention']['questions']} abstention questions were marked sufficient; their mean score was {report['abstention']['sufficient_mean_score']:.4f}, versus {report['abstention']['insufficient_mean_score']:.4f} when marked insufficient.",
            f"4. **Broad-coverage tasks are under-served.** Event ordering near-1 cited group recall is {report['by_category']['event_ordering']['stages']['cited']['near1_group_recall']:.2%}; summarization is {report['by_category']['summarization']['stages']['cited']['near1_group_recall']:.2%}.",
            f"5. **A post-retrieval reasoning residual remains.** Even when all near-1 evidence groups are Answer-visible, mean score is {report['conditions']['cited_near1_complete']['mean_official_score']:.4f}, so evidence completeness alone does not solve contradiction, temporal, and formatting/reasoning errors.",
            "",
            "## Dataset scale effect",
            "",
            "| Dataset | Candidate near-1 group recall | Cited near-1 group recall | Official score |",
            "|---|---:|---:|---:|",
        ]
    )
    for dataset, value in report["by_dataset"].items():
        lines.append(
            f"| {dataset} | {value['stages']['candidate']['near1_group_recall']:.2%} | "
            f"{value['stages']['cited']['near1_group_recall']:.2%} | {value['mean_official_score']:.4f} |"
        )
    lines.extend(
        [
            "",
            "## Integrity",
            "",
            f"- Official Search records joined: {report['integrity']['official_search_records_joined']}/600",
            f"- Exact private artifact responses joined: {report['integrity']['exact_artifact_responses']}/600",
            f"- Gold evidence markers found in immutable SQLite: {report['integrity']['gold_markers_found_in_sqlite']}/{report['integrity']['gold_markers_expected']}",
            f"- Raw question mismatches: {report['integrity']['question_mismatches']}",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chunk-dir", type=Path, required=True)
    parser.add_argument("--ingest-manifest", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--answer-model", default="gpt-4o-mini")
    args = parser.parse_args()

    if sha256_text(ANSWER_GENERATION_FOR_RAG) != ANSWER_PROMPT_SHA256:
        raise SystemExit("BEAM answer prompt hash mismatch")
    if sha256_text(UNIFIED_LLM_JUDGE_BASE_PROMPT) != JUDGE_PROMPT_SHA256:
        raise SystemExit("BEAM judge prompt hash mismatch")

    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.output_dir.chmod(0o700)

    answer_output = {
        item["qa_id"]: item
        for item in read_json(args.chunk_dir / "answer_output.json")
        if item["dataset"].startswith("beam_")
    }
    details = {
        item["qa_id"]: item
        for item in read_json(args.chunk_dir / "official_details.json")
        if item["dataset"].startswith("beam_")
    }
    raw_questions = load_raw_questions(args.chunk_dir)
    if set(answer_output) != set(details) or set(answer_output) != set(raw_questions):
        raise SystemExit("BEAM official answer/detail/raw ID mismatch")

    search_records: dict[tuple[str, tuple[str, ...], str, int], dict[str, Any]] = {}
    for item in read_jsonl(args.chunk_dir / "search_records.jsonl"):
        if item["dataset"].startswith("beam_"):
            key = request_key(item["request"])
            if key in search_records:
                raise ValueError("duplicate official BEAM Search request")
            search_records[key] = item
    if len(search_records) != 600:
        raise SystemExit(f"expected 600 BEAM Search records, got {len(search_records)}")

    artifacts: dict[
        tuple[str, tuple[str, ...], str, int], tuple[bool, dict[str, Any], str]
    ] = {}
    artifact_duplicates = 0
    artifact_files_scanned = 0
    for path in args.artifact_dir.glob("*.json"):
        try:
            artifact = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        artifact_files_scanned += 1
        key = request_key(artifact.get("search", {}))
        if key not in search_records or artifact.get("status") != "ok":
            continue
        returned = artifact.get("agent", {}).get("memory", {}).get("returned_items", [])
        official = search_records[key].get("response", {}).get("data", [])
        exact = json_compact(returned) == json_compact(official)
        previous = artifacts.get(key)
        if previous is not None:
            artifact_duplicates += 1
        if previous is None or (exact and not previous[0]):
            artifacts[key] = (exact, artifact, path.name)
    if len(artifacts) != 600:
        raise SystemExit(f"joined {len(artifacts)}/600 private BEAM artifacts")

    session_counts = load_session_counts(args.ingest_manifest)
    db = sqlite3.connect(f"file:{args.sqlite}?mode=ro&immutable=1", uri=True)
    sqlite_markers: dict[str, set[str]] = {}

    pipeline_inputs: list[dict[str, Any]] = []
    official_answers: list[dict[str, Any]] = []
    case_rows: list[dict[str, Any]] = []
    question_mismatches = 0
    gold_markers_expected = 0
    gold_markers_found = 0
    judge_models: collections.Counter[str] = collections.Counter()

    for key, search_record in search_records.items():
        ident = search_record["qa_id"]
        official_item = answer_output[ident]
        detail = details[ident]
        raw = raw_questions[ident]
        if official_item["question"] != raw["question"]:
            question_mismatches += 1

        selected = official_item["speaker_a_retrieval"]["selected"]
        context = selected_texts(official_item)
        pipeline_item = {
            "id": ident,
            "question": raw["question"],
            "context": context,
            "rubric_nuggets": raw["rubric"],
            "question_type": official_item["category"],
        }
        answer_prompt = render_answer_prompt(pipeline_item)
        judge_prompt = render_batch_judge_prompt(
            raw["question"], official_item["predicted_answer"], raw["rubric"]
        )
        pipeline_inputs.append(pipeline_item)
        official_answers.append(
            {"id": ident, "generated_answer": official_item["predicted_answer"]}
        )

        dataset, remainder = ident.split(":", 1)
        sample_id = remainder.split("#", 1)[0]
        groups = evidence_groups(
            dataset,
            sample_id,
            [str(value) for value in raw.get("evidence", [])],
            session_counts,
        )
        expected_markers = [marker for group in groups for marker in group]
        gold_markers_expected += len(expected_markers)

        user_id = search_record["request"]["user_id"]
        if user_id not in sqlite_markers:
            scope_id = "leaderboard-" + hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
            found: set[str] = set()
            for (content,) in db.execute(
                "SELECT content FROM memories WHERE scope_id = ?", (scope_id,)
            ):
                found.update(MARKER_RE.findall(content))
            sqlite_markers[user_id] = found
        gold_markers_found += sum(
            marker in sqlite_markers[user_id] for marker in expected_markers
        )

        exact_response, artifact, artifact_name = artifacts[key]
        memory = artifact["agent"]["memory"]
        cited_memories = [item for item in memory["searched_memories"] if item.get("cited")]
        stages = {
            "candidate": stage_metrics(groups, marker_set(memory["searched_memories"])),
            "read": stage_metrics(groups, marker_set(memory["read_evidence"])),
            "cited": stage_metrics(groups, marker_set(cited_memories)),
        }
        plan = search_plan_stats(artifact["agent"]["reasoning_trace"])
        package = parse_package(selected)
        criterion_scores = detail["metrics"]["criterion_scores"]
        if len(criterion_scores) != len(raw["rubric"]):
            raise ValueError(f"rubric count mismatch for {ident}")
        judge_models[str(detail["metrics"].get("evaluator_model", "unknown"))] += 1

        case_rows.append(
            {
                "qa_id": ident,
                "dataset": dataset,
                "category": official_item["category"],
                "official_score": float(detail["score"]),
                "strict_accuracy": float(detail["metrics"]["strict_accuracy"]),
                "criterion_count": len(criterion_scores),
                "criterion_score_sum": sum(float(item["score"]) for item in criterion_scores),
                "package_status": package.get("status", "missing"),
                "candidate_count": len(memory["searched_memories"]),
                "read_count": len(memory["read_evidence"]),
                "cited_raw_count": sum(
                    not item["id"].startswith("pimem-package-")
                    for item in memory["returned_items"]
                ),
                "search_call_count": plan["search_call_count"],
                "planned_query_count": plan["planned_query_count"],
                "operators": plan["operators"],
                "first_operator": plan["first_operator"],
                "context_chars": len(context_text(pipeline_item)),
                "answer_chars": len(official_item["predicted_answer"]),
                "expected_group_count": len(groups),
                "expected_marker_count": len(expected_markers),
                "candidate": stages["candidate"],
                "read": stages["read"],
                "cited": stages["cited"],
                "answer_prompt_sha256": sha256_text(answer_prompt),
                "judge_prompt_sha256": sha256_text(judge_prompt),
                "artifact_file": artifact_name,
                "artifact_response_exact": exact_response,
            }
        )

    db.close()
    case_rows.sort(key=lambda item: item["qa_id"])
    pipeline_inputs.sort(key=lambda item: item["id"])
    official_answers.sort(key=lambda item: item["id"])

    overall = summarize_rows(case_rows)
    abstention = [row for row in case_rows if row["category"] == "abstention"]
    abstention_sufficient = [
        row for row in abstention if row["package_status"] == "sufficient"
    ]
    abstention_insufficient = [
        row for row in abstention if row["package_status"] == "insufficient"
    ]
    evidence_rows = [row for row in case_rows if row["expected_group_count"]]

    operator_usage = collections.Counter(
        operator for row in case_rows for operator in row["operators"]
    )
    first_operator_usage = collections.Counter(row["first_operator"] for row in case_rows)

    report = {
        "pipeline": {
            "answer_model": args.answer_model,
            "answer_model_source": "run assertion supplied by evaluator owner; not present in archive metadata",
            "answer_prompt_sha256": ANSWER_PROMPT_SHA256,
            "judge_model": judge_models.most_common(1)[0][0],
            "judge_prompt_sha256": JUDGE_PROMPT_SHA256,
            "temperature": 0,
            "answer_max_tokens": 512,
            "judge_score_values": [0.0, 0.5, 1.0],
        },
        "overall": overall,
        "retrieval_behavior": {
            "operator_usage": dict(operator_usage.most_common()),
            "first_operator_usage": dict(first_operator_usage.most_common()),
        },
        "by_dataset": grouped_summary(case_rows, "dataset"),
        "by_category": grouped_summary(case_rows, "category"),
        "abstention": {
            "questions": len(abstention),
            "sufficient_questions": len(abstention_sufficient),
            "insufficient_questions": len(abstention_insufficient),
            "sufficient_mean_score": rounded(mean(abstention_sufficient, "official_score")),
            "insufficient_mean_score": rounded(mean(abstention_insufficient, "official_score")),
        },
        "conditions": {
            "candidate_near1_complete": condition_summary(
                evidence_rows, lambda row: row["candidate"]["near1_all_groups"]
            ),
            "candidate_near1_complete_but_cited_incomplete": condition_summary(
                evidence_rows,
                lambda row: row["candidate"]["near1_all_groups"]
                and not row["cited"]["near1_all_groups"],
            ),
            "candidate_near1_incomplete": condition_summary(
                evidence_rows, lambda row: not row["candidate"]["near1_all_groups"]
            ),
            "cited_near1_complete": condition_summary(
                evidence_rows, lambda row: row["cited"]["near1_all_groups"]
            ),
            "cited_near1_incomplete": condition_summary(
                evidence_rows, lambda row: not row["cited"]["near1_all_groups"]
            ),
        },
        "integrity": {
            "artifact_files_scanned": artifact_files_scanned,
            "artifact_duplicate_successes": artifact_duplicates,
            "official_search_records_joined": len(search_records),
            "private_artifacts_joined": len(artifacts),
            "exact_artifact_responses": sum(value[0] for value in artifacts.values()),
            "gold_markers_expected": gold_markers_expected,
            "gold_markers_found_in_sqlite": gold_markers_found,
            "question_mismatches": question_mismatches,
        },
    }

    write_jsonl(args.output_dir / "beam_pipeline_input.jsonl", pipeline_inputs)
    write_jsonl(args.output_dir / "beam_official_answers.jsonl", official_answers)
    write_jsonl(args.output_dir / "beam_case_analysis.jsonl", case_rows)
    write_json(args.output_dir / "BEAM_FAILURE_ANALYSIS.json", report)
    report_path = args.output_dir / "BEAM_FAILURE_ANALYSIS.md"
    report_path.write_text(markdown_report(report), encoding="utf-8")
    report_path.chmod(0o600)
    write_json(
        args.output_dir / "MANIFEST.json",
        {
            "source_chunk_dir": str(args.chunk_dir),
            "source_ingest_manifest": str(args.ingest_manifest),
            "source_artifact_dir": str(args.artifact_dir),
            "source_sqlite": str(args.sqlite),
            "outputs": [
                "beam_pipeline_input.jsonl",
                "beam_official_answers.jsonl",
                "beam_case_analysis.jsonl",
                "BEAM_FAILURE_ANALYSIS.json",
                "BEAM_FAILURE_ANALYSIS.md",
            ],
            "pipeline": report["pipeline"],
            "integrity": report["integrity"],
        },
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
