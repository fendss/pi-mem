#!/usr/bin/env python3
"""Index private PiMem Agent artifacts against gold-isolated Search rows."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "pimem-agent-artifact-index/v1"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{path} is not a JSON object")
    return value


def build_index(search_results: Path, artifact_dir: Path, output: Path) -> dict[str, int]:
    by_package: dict[str, tuple[Path, dict[str, Any]]] = {}
    failures = 0
    duplicate_successes = 0
    for path in sorted(artifact_dir.glob("*.json")):
        artifact = load_json(path)
        if artifact.get("schema_version") != "pimem-agent-search-artifact/v1":
            raise ValueError(f"Unexpected Agent artifact schema: {path}")
        if artifact.get("status") != "ok":
            failures += 1
            continue
        search = artifact.get("search")
        agent = artifact.get("agent")
        if not isinstance(search, dict) or not isinstance(agent, dict):
            raise ValueError(f"Incomplete Agent artifact: {path}")
        package_id = search.get("package_id")
        if not isinstance(package_id, str) or not package_id:
            raise ValueError(f"Agent artifact has no package_id: {path}")
        if package_id in by_package:
            duplicate_successes += 1
        reasoning = agent.get("reasoning_trace")
        memory = agent.get("memory")
        if not isinstance(reasoning, list) or not isinstance(memory, dict):
            raise ValueError(f"Agent artifact lacks reasoning or memory: {path}")
        if not isinstance(memory.get("returned_items"), list):
            raise ValueError(f"Agent artifact lacks returned memory items: {path}")
        by_package[package_id] = (path, artifact)

    rows = 0
    matched = 0
    errors = 0
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with search_results.open(encoding="utf-8") as source, temporary.open(
        "w", encoding="utf-8"
    ) as destination:
        os.chmod(temporary, 0o600)
        for line in source:
            if not line.strip():
                continue
            row = json.loads(line)
            rows += 1
            if row.get("status") != "ok":
                errors += 1
                continue
            data = row.get("data")
            if not isinstance(data, list) or not data or not isinstance(data[0], dict):
                raise ValueError(f"Search row {rows} has no evidence package")
            package_id = data[0].get("id")
            match = by_package.get(str(package_id))
            if match is None:
                raise ValueError(f"No Agent artifact for Search package {package_id}")
            path, artifact = match
            agent = artifact["agent"]
            memory = agent["memory"]
            destination.write(
                json.dumps(
                    {
                        "schema_version": SCHEMA_VERSION,
                        "benchmark": row["benchmark"],
                        "run_id": row["run_id"],
                        "source_record_id": row["source_record_id"],
                        "source_question_id": row["source_question_id"],
                        "package_id": package_id,
                        "agent_run_id": agent["run_id"],
                        "agent_artifact": str(path.resolve()),
                        "reasoning_steps": len(agent["reasoning_trace"]),
                        "candidate_memories": len(memory.get("candidates", [])),
                        "read_memories": len(memory.get("read_evidence", [])),
                        "returned_items": len(memory.get("returned_items", [])),
                        "retrieval_profile": agent["retrieval"]["retrievalProfile"],
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "\n"
            )
            matched += 1
        destination.flush()
        os.fsync(destination.fileno())
    temporary.replace(output)
    return {
        "search_rows": rows,
        "successful_searches": matched,
        "search_errors": errors,
        "agent_failures": failures,
        "unmatched_success_artifacts": len(by_package) - matched,
        "duplicate_success_artifacts": duplicate_successes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("search_results", type=Path)
    parser.add_argument("artifact_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    summary = build_index(args.search_results, args.artifact_dir, args.output)
    print(json.dumps(summary, separators=(",", ":")))


if __name__ == "__main__":
    main()
