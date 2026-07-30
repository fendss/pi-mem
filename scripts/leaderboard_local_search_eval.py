#!/usr/bin/env python3
"""Run registered MemMachine benchmarks through PiMem Add/Search only.

This runner deliberately produces no answers or scores. Benchmark references
(gold answers, rubrics, supporting facts, and evaluator labels) are never sent
to PiMem and are never written to the search artifact.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable, Sequence

SCHEMA_VERSION = "pimem-local-search-artifact/v1"
RETRYABLE = {408, 425, 429, 500, 502, 503, 504}
MAX_MESSAGES_PER_ADD = 20
MAX_WORDS_PER_ADD = 2_000
MAX_CONTENT_CHARS = 450_000
MAX_CHARS_PER_ADD = 1_500_000
QUERY_MAX_CHARS = 24_000
FORBIDDEN_OUTPUT_KEYS = {
    "answer",
    "answer_fixed",
    "golden_answer",
    "model_answer",
    "predicted_answer",
    "supporting_facts",
    "rubric",
    "evaluation_strategy",
    "adversarial_answer",
    "ideal_response",
    "evidence",
}


@dataclass(frozen=True)
class RegisteredBenchmark:
    name: str
    source: Any


class PiMemApiError(RuntimeError):
    def __init__(self, status: int, reason: str) -> None:
        super().__init__(f"PiMem HTTP {status}: {reason}")
        self.status = status


class PiMemClient:
    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def post(self, path: str, payload: dict[str, Any], attempts: int) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        last_error: BaseException | None = None
        for attempt in range(1, attempts + 1):
            request = urllib.request.Request(
                f"{self.base_url}{path}",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    parsed = json.loads(response.read().decode("utf-8"))
                    if not isinstance(parsed, dict):
                        raise TypeError("PiMem response must be a JSON object")
                    return parsed
            except urllib.error.HTTPError as error:
                reason = "request failed"
                try:
                    value = json.loads(error.read().decode("utf-8"))
                    reason = str(value.get("detail", {}).get("reason", reason))
                except Exception:
                    pass
                last_error = PiMemApiError(error.code, reason)
                if error.code not in RETRYABLE or attempt == attempts:
                    raise last_error
            except (TimeoutError, urllib.error.URLError, ConnectionError) as error:
                last_error = error
                if attempt == attempts:
                    raise
            time.sleep(min(30.0, float(2 ** (attempt - 1))))
        assert last_error is not None
        raise last_error


def load_registry(memmachine_root: Path) -> tuple[Any, dict[str, RegisteredBenchmark]]:
    root = memmachine_root.resolve()
    if not (root / "evaluation" / "retrieval_agent" / "external_benchmarks.py").exists():
        raise FileNotFoundError(f"MemMachine benchmark registry is missing under {root}")
    sys.path.insert(0, str(root))
    module = importlib.import_module("evaluation.retrieval_agent.external_benchmarks")
    registry = {
        name: RegisteredBenchmark(name=name, source=source)
        for name, source in module.SOURCES.items()
    }
    return module, registry


def stable_digest(*parts: str, length: int = 24) -> str:
    digest = hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()
    return digest[:length]


def user_id(run_id: str, benchmark: str, record_id: str) -> str:
    return f"local:{run_id}:{benchmark}:{stable_digest(record_id)}"


def api_session_id(run_id: str, benchmark: str, record_id: str, session_id: str) -> str:
    return f"local:{stable_digest(run_id, benchmark, record_id, session_id, length=40)}"


def normalize_role(raw: Any) -> tuple[str, str | None]:
    label = str(raw or "user").strip()
    normalized = label.casefold()
    if normalized in {"assistant", "ai", "bot", "gpt"} or "assistant" in normalized:
        return "assistant", None if normalized == "assistant" else label
    if normalized == "user":
        return "user", None
    return "user", label or None


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def split_content(text: str) -> list[str]:
    """Split an oversized source message without adding synthetic text."""
    remaining = text
    output: list[str] = []
    while remaining:
        if len(remaining) <= MAX_CONTENT_CHARS and word_count(remaining) <= MAX_WORDS_PER_ADD:
            output.append(remaining)
            break
        character_limit = min(len(remaining), MAX_CONTENT_CHARS)
        token_ends = [match.end() for match in re.finditer(r"\S+", remaining[:character_limit])]
        if len(token_ends) > MAX_WORDS_PER_ADD:
            character_limit = token_ends[MAX_WORDS_PER_ADD - 1]
        window = remaining[:character_limit]
        sentence_breaks = [
            match.end()
            for match in re.finditer(r"(?:[.!?。！？]\s*|\n+)", window)
        ]
        cut = sentence_breaks[-1] if sentence_breaks else character_limit
        if cut <= 0:
            cut = min(len(remaining), MAX_CONTENT_CHARS)
        output.append(remaining[:cut])
        remaining = remaining[cut:]
    return [part for part in output if part]


def iter_session_messages(mm: Any, record: Any) -> Iterable[tuple[str, list[dict[str, Any]]]]:
    for session_index, (source_session_id, raw_time, raw_messages) in enumerate(record.sessions):
        start = mm._parse_timestamp(raw_time, session_index)
        messages: list[dict[str, Any]] = []
        for message_index, message in enumerate(raw_messages):
            if not isinstance(message, dict):
                continue
            content = mm._message_content(message)
            if not content:
                continue
            raw_role = message.get("role", message.get("speaker", "user"))
            role, source_speaker = normalize_role(raw_role)
            if source_speaker:
                content = f"[{source_speaker}] {content}"
            for part_index, part in enumerate(split_content(content)):
                timestamp = start + timedelta(
                    seconds=message_index,
                    microseconds=part_index * 1_000,
                )
                messages.append(
                    {
                        "role": role,
                        "content": part,
                        "timestamp": int(timestamp.timestamp() * 1_000),
                    }
                )
        yield str(source_session_id), messages


def chunk_messages(messages: Sequence[dict[str, Any]]) -> Iterable[list[dict[str, Any]]]:
    chunk: list[dict[str, Any]] = []
    words = 0
    characters = 0
    for message in messages:
        content = str(message["content"])
        message_words = max(1, word_count(content))
        message_characters = len(content)
        if chunk and (
            len(chunk) >= MAX_MESSAGES_PER_ADD
            or words + message_words > MAX_WORDS_PER_ADD
            or characters + message_characters > MAX_CHARS_PER_ADD
        ):
            yield chunk
            chunk = []
            words = 0
            characters = 0
        chunk.append(message)
        words += message_words
        characters += message_characters
    if chunk:
        yield chunk


def bounded_query(text: str) -> tuple[str, bool]:
    if len(text) <= QUERY_MAX_CHARS:
        return text, False
    prefix_length = QUERY_MAX_CHARS // 4
    suffix_length = QUERY_MAX_CHARS - prefix_length
    return (
        text[:prefix_length]
        + "\n\n[Long inline context omitted from the query; retrieve it from memory.]\n\n"
        + text[-suffix_length:],
        True,
    )


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def completed_records(path: Path) -> set[str]:
    if not path.exists():
        return set()
    value = json.loads(path.read_text(encoding="utf-8"))
    return set(str(item) for item in value.get("completed_record_ids", []))


def ingest_benchmark(
    mm: Any,
    registered: RegisteredBenchmark,
    records: Sequence[Any],
    client: PiMemClient,
    run_id: str,
    output_dir: Path,
    attempts: int,
) -> Path:
    state_path = output_dir / "ingest-state.json"
    completed = completed_records(state_path)
    for record in records:
        record_id = str(record.source_record_id)
        if record_id in completed:
            continue
        scope_user_id = user_id(run_id, registered.name, record_id)
        for source_session_id, messages in iter_session_messages(mm, record):
            session_id = api_session_id(
                run_id,
                registered.name,
                record_id,
                source_session_id,
            )
            for chunk_index, chunk in enumerate(chunk_messages(messages)):
                request_id = "local-add-" + stable_digest(
                    run_id,
                    registered.name,
                    record_id,
                    source_session_id,
                    str(chunk_index),
                    length=48,
                )
                response = client.post(
                    "/v1/memories/add",
                    {
                        "request_id": request_id,
                        "messages": chunk,
                        "user_id": scope_user_id,
                        "session_id": session_id,
                    },
                    attempts=attempts,
                )
                expected = {
                    "success": True,
                    "request_id": request_id,
                    "user_id": scope_user_id,
                    "session_id": session_id,
                }
                if response != expected:
                    raise ValueError(f"Invalid Add response for {registered.name}:{record_id}")
        completed.add(record_id)
        atomic_json(
            state_path,
            {
                "schema_version": "pimem-local-ingest-state/v1",
                "benchmark": registered.name,
                "run_id": run_id,
                "completed_record_ids": sorted(completed),
                "completed_records": len(completed),
            },
        )
    return state_path


def existing_search_keys(path: Path) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    if not path.exists():
        return keys
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                keys.add((str(row["source_record_id"]), str(row["source_question_id"])))
    return keys


def validate_search_response(value: dict[str, Any], top_k: int) -> None:
    if set(value) != {"data"} or not isinstance(value["data"], list):
        raise ValueError("Search response must contain only a data array")
    if len(value["data"]) > top_k:
        raise ValueError("Search response exceeds top_k")
    for index, item in enumerate(value["data"]):
        if not isinstance(item, dict):
            raise ValueError(f"Search item {index} must be an object")
        if not isinstance(item.get("id"), str) or not item["id"]:
            raise ValueError(f"Search item {index} has no id")
        if not isinstance(item.get("content"), str) or not item["content"]:
            raise ValueError(f"Search item {index} has no content")


def assert_no_forbidden_keys(value: Any) -> None:
    if isinstance(value, dict):
        overlap = FORBIDDEN_OUTPUT_KEYS.intersection(value)
        if overlap:
            raise ValueError(f"Forbidden evaluation fields in search artifact: {sorted(overlap)}")
        for child in value.values():
            assert_no_forbidden_keys(child)
    elif isinstance(value, list):
        for child in value:
            assert_no_forbidden_keys(child)


def search_benchmark(
    registered: RegisteredBenchmark,
    records: Sequence[Any],
    client: PiMemClient,
    run_id: str,
    output_dir: Path,
    top_k: int,
    attempts: int,
    concurrency: int,
    max_questions_per_record: int,
) -> Path:
    artifact_path = output_dir / "search-results.jsonl"
    done = existing_search_keys(artifact_path)
    work: list[tuple[int, Any, Any]] = []
    index = 0
    for record in records:
        questions = record.questions
        if max_questions_per_record > 0:
            questions = questions[:max_questions_per_record]
        for question in questions:
            key = (str(record.source_record_id), str(question.source_question_id))
            if key not in done:
                work.append((index, record, question))
            index += 1

    def run_one(item: tuple[int, Any, Any]) -> tuple[int, dict[str, Any]]:
        order, record, question = item
        query, truncated = bounded_query(str(question.question))
        options = [str(option) for option in question.options]
        request = {
            "query": query,
            **({"options": options} if options else {}),
            "user_id": user_id(run_id, registered.name, str(record.source_record_id)),
            "top_k": top_k,
        }
        started = time.monotonic()
        try:
            response = client.post(
                "/v1/memories/search",
                request,
                attempts=attempts,
            )
            validate_search_response(response, top_k)
            row = {
                "schema_version": SCHEMA_VERSION,
                "benchmark": registered.name,
                "run_id": run_id,
                "source_record_id": str(record.source_record_id),
                "source_question_id": str(question.source_question_id),
                "query": query,
                **({"options": options} if options else {}),
                "query_truncated": truncated,
                "top_k": top_k,
                "status": "ok",
                "duration_ms": round((time.monotonic() - started) * 1_000),
                "data": response["data"],
            }
        except Exception as error:
            row = {
                "schema_version": SCHEMA_VERSION,
                "benchmark": registered.name,
                "run_id": run_id,
                "source_record_id": str(record.source_record_id),
                "source_question_id": str(question.source_question_id),
                "query": query,
                **({"options": options} if options else {}),
                "query_truncated": truncated,
                "top_k": top_k,
                "status": "error",
                "duration_ms": round((time.monotonic() - started) * 1_000),
                "error_type": type(error).__name__,
                "error": str(error)[:1_000],
                "data": [],
            }
        assert_no_forbidden_keys(row)
        return order, row

    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with artifact_path.open("a", encoding="utf-8") as output:
        os.chmod(artifact_path, 0o600)
        for start in range(0, len(work), concurrency):
            batch = work[start : start + concurrency]
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
                completed = list(executor.map(run_one, batch))
            for _, row in sorted(completed, key=lambda pair: pair[0]):
                output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                output.flush()
                os.fsync(output.fileno())
    return artifact_path


def selected_records(mm: Any, source: Any, max_records: int, offset: int) -> list[Any]:
    records = mm.load_records(source)
    return mm._selected_records(records, max_records, offset, 0)


def write_summary(path: Path, artifact_path: Path, benchmark: str, run_id: str) -> None:
    counts = {"ok": 0, "error": 0}
    rows = 0
    with artifact_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            assert_no_forbidden_keys(row)
            counts[str(row["status"])] = counts.get(str(row["status"]), 0) + 1
            rows += 1
    atomic_json(
        path,
        {
            "schema_version": "pimem-local-search-summary/v1",
            "benchmark": benchmark,
            "run_id": run_id,
            "rows": rows,
            "status_counts": counts,
            "artifact": str(artifact_path),
        },
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["registry", "ingest", "search", "run"])
    parser.add_argument("benchmark", nargs="?", default="all")
    parser.add_argument(
        "--memmachine-root",
        type=Path,
        default=Path(os.environ.get("MEMMACHINE_ROOT", "/home/zhaogangyi/MemMachine")),
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:19088")
    parser.add_argument("--run-id", default="pimem-local-search")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("/home/zhaogangyi/pi-mem-local-eval"),
    )
    parser.add_argument("--top-k", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=620.0)
    parser.add_argument("--max-records", type=int, default=0)
    parser.add_argument("--max-questions-per-record", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if min(args.top_k, args.concurrency, args.attempts) <= 0:
        raise ValueError("top-k, concurrency, and attempts must be positive")
    if min(args.max_records, args.max_questions_per_record, args.offset) < 0:
        raise ValueError("record/question limits and offset must be non-negative")
    os.umask(0o077)
    mm, registry = load_registry(args.memmachine_root)
    if args.action == "registry":
        value = {
            "schema_version": "pimem-local-benchmark-registry/v1",
            "memmachine_root": str(args.memmachine_root.resolve()),
            "benchmarks": [
                {
                    "name": item.name,
                    "data_path": str(item.source.data_path),
                    "kind": str(item.source.kind),
                    "questions_path": (
                        None
                        if item.source.questions_path is None
                        else str(item.source.questions_path)
                    ),
                }
                for item in registry.values()
            ],
        }
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return
    if args.benchmark == "all" or args.benchmark not in registry:
        raise ValueError("ingest/search/run require one registered benchmark name")
    registered = registry[args.benchmark]
    records = selected_records(mm, registered.source, args.max_records, args.offset)
    output_dir = args.output_root / args.run_id / registered.name
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    client = PiMemClient(args.base_url, args.timeout_seconds)
    if args.action in {"ingest", "run"}:
        state = ingest_benchmark(
            mm,
            registered,
            records,
            client,
            args.run_id,
            output_dir,
            args.attempts,
        )
        print(state)
    if args.action in {"search", "run"}:
        artifact = search_benchmark(
            registered,
            records,
            client,
            args.run_id,
            output_dir,
            args.top_k,
            args.attempts,
            args.concurrency,
            args.max_questions_per_record,
        )
        write_summary(
            output_dir / "search-summary.json",
            artifact,
            registered.name,
            args.run_id,
        )
        print(artifact)


if __name__ == "__main__":
    main()
