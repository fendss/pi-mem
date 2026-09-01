#!/usr/bin/env python3
"""Finalize and hash-lock the candidate read-burden diagnostic artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    fsync_directory(path.parent)


def write_json(path: Path, value: Any) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def artifact(path: Path, root: Path) -> dict[str, Any]:
    metadata = path.stat()
    return {
        "path": str(path.resolve()),
        "relative_path": str(path.relative_to(root)),
        "bytes": metadata.st_size,
        "mode": oct(stat.S_IMODE(metadata.st_mode)),
        "sha256": sha256_file(path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", type=Path, required=True)
    args = parser.parse_args()
    root = args.experiment.resolve()
    prep_manifest = read_json(root / "PREPARATION_MANIFEST.json")
    preparation = read_json(Path(prep_manifest["preparation"]))
    run_manifest = read_json(root / "RUN_MANIFEST.json")
    answers = read_json(root / "answers/answer-results.json")
    judge_input = read_json(root / "judge-input/paired-answers.json")
    judge = read_json(root / "evaluation/gpt4o-official/paired-results.json")
    summary = read_json(root / "analysis/paired-summary.json")
    if run_manifest["status"] != "complete" or judge["status"] != "complete":
        raise ValueError("Run is not complete")
    if preparation["selection"]["candidate_stage_count"] != 58 or (
        preparation["selection"]["candidate_stage_current_judge_strata"]
        != {"correct": 36, "incorrect": 22}
    ):
        raise ValueError("Corrected stage eligibility changed")
    if preparation["selection"]["wrong_only_filter_applied"] is not False:
        raise ValueError("Eligibility was filtered to wrong-only")
    if len(answers["rows"]) != 196 or len(judge["rows"]) != 196:
        raise ValueError("Paired outputs are incomplete")
    if any(row["attempts"] != 1 for row in answers["rows"] + judge["rows"]):
        raise ValueError("Successful-output attempt semantics changed")
    if any(row["infrastructure_attempts"] != 1 for row in answers["rows"] + judge["rows"]):
        raise ValueError("Unexpected infrastructure recovery occurred")
    if sha256_file(Path(run_manifest["answer_results"])) != run_manifest["answer_results_sha256"]:
        raise ValueError("Answer result hash changed")
    if sha256_file(Path(run_manifest["judge_results"])) != run_manifest["judge_results_sha256"]:
        raise ValueError("Judge result hash changed")
    if sha256_file(Path(run_manifest["summary"])) != run_manifest["summary_sha256"]:
        raise ValueError("Summary hash changed")
    if sha256_file(Path(run_manifest["judge_input"])) != run_manifest["judge_input_sha256"]:
        raise ValueError("Judge input hash changed")
    for item in preparation["source_hashes"].values():
        if sha256_file(Path(item["path"])) != item["sha256"]:
            raise ValueError(f"Frozen source changed: {item['path']}")

    stage = summary["primary"]["candidate_all_not_read_stage"]
    guard = summary["primary"]["all_gold_read_answer_correct_guard"]
    wrong = summary["pre_registered_current_judge_strata"][
        "candidate_stage_currently_incorrect"
    ]
    a_rows = [row for row in answers["rows"] if row["arm"] == "a_current_exact_read"]
    b_rows = [
        row
        for row in answers["rows"]
        if row["arm"] == "b_current_plus_top4_unread_parent"
    ]
    a_prompt = sum(row["usage"]["prompt_tokens"] for row in a_rows)
    b_prompt = sum(row["usage"]["prompt_tokens"] for row in b_rows)
    a_total = sum(row["usage"]["total_tokens"] for row in a_rows)
    b_total = sum(row["usage"]["total_tokens"] for row in b_rows)
    a_latency = sum(row["elapsed_seconds"] for row in a_rows) / len(a_rows)
    b_latency = sum(row["elapsed_seconds"] for row in b_rows) / len(b_rows)
    report = f"""# Candidate read-burden fixed-trace diagnostic

状态：完成。该实验是 gold-conditioned fixed-trace 诊断，不是 full-300 端到端成绩。

## 结论

盲目自动 inspect 首次搜索中前 4 个未读 parent，不能可靠解决“候选存在但 Agent 没有 read”的问题。

- `candidate_all_not_read` stage（58 题）：A {stage['a_current_exact_read']['correct']}/58，B {stage['b_current_plus_top4_unread_parent']['correct']}/58，净增 1 题；A-only {stage['paired_flips']['a_only']}，B-only {stage['paired_flips']['b_only']}，McNemar p={stage['mcnemar_exact_two_sided_p']}。
- 其中当前原始 judge 错误的 22 题：A {wrong['a_current_exact_read']['correct']}/22，B {wrong['b_current_plus_top4_unread_parent']['correct']}/22，净增 0；A-only {wrong['paired_flips']['a_only']}，B-only {wrong['paired_flips']['b_only']}。
- `all_gold_read_answer_correct` guard（40 题）：A {guard['a_current_exact_read']['correct']}/40，B {guard['b_current_plus_top4_unread_parent']['correct']}/40，净增 1 题；McNemar p={guard['mcnemar_exact_two_sided_p']}。

因此没有证据支持把 blanket top-4 auto-inspect 合入 production。它产生少量双向翻转，而不是稳定恢复错误题。

## 成本

- A prompt tokens：{a_prompt:,}；B：{b_prompt:,}（{(b_prompt / a_prompt - 1) * 100:.1f}%）。
- A total answer tokens：{a_total:,}；B：{b_total:,}（{(b_total / a_total - 1) * 100:.1f}%）。
- 平均 answer latency：A {a_latency:.2f}s；B {b_latency:.2f}s（{(b_latency / a_latency - 1) * 100:.1f}%）。
- 总调用：196 次 fresh GPT-5-mini answer + 196 次 fresh GPT-4o official judge。

## 完整性边界

- 58 题是完整 stage 集合，其中原始 judge 36 对、22 错；没有 wrong-only 过滤。
- gold 只用于 eligibility/诊断分层；B 始终按首次成功 search 的 full-page display order 选前 4 个未读 parent。
- A 与保存的 E0 answer prompt 98/98 byte-exact；B 使用冻结 production `projectMemoryEvidenceBatch`。
- answer/judge 成功输出均为 `attempts=1`；两阶段均无基础设施重试或成功输出丢弃。
- 结果不得外推成 full-300 分数。
"""
    report_path = root / "analysis/report-zh.md"
    write_text(report_path, report)

    core_paths = [
        root / "PREPARATION_MANIFEST.json",
        root / "preparation/eligibility-and-prompts.json",
        root / "scripts/candidate_read_burden_ablation.py",
        root / "scripts/project_candidate_read_batches.mjs",
        root / "scripts/run_candidate_read_burden_answers.py",
        root / "scripts/run_candidate_read_burden_judge.mjs",
        root / "answers/answer-results.json",
        root / "judge-input/paired-answers.json",
        root / "evaluation/gpt4o-official/paired-results.json",
        root / "analysis/paired-summary.json",
        report_path,
        root / "RUN_MANIFEST.json",
    ]
    secret_pattern_files = 0
    secret_pattern = re.compile(rb"sk-[A-Za-z0-9_-]{20,}")
    for path in root.rglob("*"):
        if path.is_file() and secret_pattern.search(path.read_bytes()) is not None:
            secret_pattern_files += 1
    if secret_pattern_files:
        raise ValueError("A secret-like token appears in experiment artifacts")
    final = {
        "schema_version": 1,
        "status": "complete",
        "experiment": preparation["experiment"],
        "claim_boundary": summary["claim_boundary"],
        "eligibility": {
            "candidate_stage_count": 58,
            "candidate_stage_current_correct": 36,
            "candidate_stage_current_incorrect": 22,
            "candidate_stage_ids_sha256": preparation["selection"][
                "candidate_stage_ids_sha256"
            ],
            "guard_count": 40,
            "wrong_only_filter_applied": False,
        },
        "results": summary["primary"],
        "current_wrong_stratum": wrong,
        "cost": {
            **summary["cost"],
            "a_prompt_tokens": a_prompt,
            "b_prompt_tokens": b_prompt,
            "b_prompt_token_increase": b_prompt / a_prompt - 1,
            "a_total_answer_tokens": a_total,
            "b_total_answer_tokens": b_total,
            "b_total_answer_token_increase": b_total / a_total - 1,
            "a_mean_answer_latency_seconds": a_latency,
            "b_mean_answer_latency_seconds": b_latency,
        },
        "attempt_audit": summary["attempts"],
        "secret_like_token_files": secret_pattern_files,
        "artifacts": {
            path.relative_to(root).as_posix(): artifact(path, root)
            for path in core_paths
        },
    }
    final_path = root / "FINAL_MANIFEST.json"
    write_json(final_path, final)
    checksum_paths = core_paths + [final_path]
    checksums = "".join(
        f"{sha256_file(path)}  {path.resolve()}\n" for path in checksum_paths
    )
    write_text(root / "FINAL_SHA256SUMS", checksums)
    print(json.dumps(final, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
