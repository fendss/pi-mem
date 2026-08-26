from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from .artifacts import read_json, write_json_atomic
from .chunking import chunk_text
from .clients import ChatClient, MemoryClient
from .config import SYSTEM_PROMPT, TaskConfig
from .contracts import Context
from .dataset import load_pins
from .scoring import score_prediction


@dataclass(frozen=True)
class RunSettings:
    output_path: Path
    max_contexts: int | None = None
    max_queries: int | None = None
    resume: bool = False


def _user_id(task: TaskConfig, context: Context, output_path: Path) -> str:
    identity = f"{task.task_id}\0{context.ordinal}\0{output_path.resolve()}"
    return "mab-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def _new_document(task: TaskConfig, memory: MemoryClient, chat: ChatClient) -> dict:
    pins = load_pins()
    return {
        "schema_version": 1,
        "benchmark": "MemoryAgentBench",
        "task": task.task_id,
        "capability": task.capability,
        "source": task.source,
        "official_metric": task.official_metric,
        "official_config": task.official_config,
        "memorize_template_sha256": hashlib.sha256(
            task.memorize_template.encode("utf-8")
        ).hexdigest(),
        "query_template_sha256": hashlib.sha256(
            task.query_template.encode("utf-8")
        ).hexdigest(),
        "benchmark_commit": pins["benchmark"]["commit"],
        "dataset_revision": pins["dataset"]["revision"],
        "memory_base_url": memory.http.base_url,
        "memory_system_name": memory.memory_system_name,
        "answer_model": chat.model,
        "answer_base_url": chat.http.base_url,
        "data": [],
        "metrics": {},
    }


def _summarize(document: dict) -> None:
    rows = document["data"]
    metric_names = {name for row in rows for name in row.get("metrics", {})}
    summary: dict[str, float | None] = {}
    for name in sorted(metric_names):
        values = [row["metrics"][name] for row in rows if row["metrics"].get(name) is not None]
        summary[name] = sum(values) / len(values) if values else None
    document["metrics"] = summary
    document["completed_queries"] = len(rows)


def _validate_resume_document(
    document: dict,
    expected: dict,
    contexts: Sequence[Context],
) -> None:
    identity_fields = (
        "schema_version",
        "benchmark",
        "task",
        "capability",
        "source",
        "official_metric",
        "official_config",
        "memorize_template_sha256",
        "query_template_sha256",
        "benchmark_commit",
        "dataset_revision",
        "memory_base_url",
        "memory_system_name",
        "answer_model",
        "answer_base_url",
    )
    for field in identity_fields:
        if document.get(field) != expected[field]:
            raise ValueError(f"Resume output {field} does not match this run")

    rows = document.get("data")
    if not isinstance(rows, list):
        raise ValueError("Resume output data must be a list")
    valid_ids = {
        query.qa_pair_id for context in contexts for query in context.queries
    }
    if len(valid_ids) != sum(len(context.queries) for context in contexts):
        raise ValueError("Dataset contains duplicate qa_pair_id values")
    completed_ids = [row.get("qa_pair_id") for row in rows if isinstance(row, dict)]
    if len(completed_ids) != len(rows) or any(
        not isinstance(value, str) or value not in valid_ids for value in completed_ids
    ):
        raise ValueError("Resume output contains an unknown qa_pair_id")
    if len(set(completed_ids)) != len(completed_ids):
        raise ValueError("Resume output contains duplicate qa_pair_id values")


def execute_run(
    task: TaskConfig,
    contexts: Sequence[Context],
    memory: MemoryClient,
    chat: ChatClient,
    settings: RunSettings,
    chunker: Callable[[str, int], list[str]] = chunk_text,
) -> dict:
    expected_document = _new_document(task, memory, chat)
    if settings.resume and settings.output_path.exists():
        document = read_json(settings.output_path)
        _validate_resume_document(document, expected_document, contexts)
    else:
        document = expected_document
    completed = {row["qa_pair_id"] for row in document["data"]}
    query_limit = settings.max_queries
    processed_now = 0
    selected_contexts = contexts[
        : settings.max_contexts if settings.max_contexts is not None else len(contexts)
    ]
    for context in selected_contexts:
        pending = [query for query in context.queries if query.qa_pair_id not in completed]
        if not pending:
            continue
        user_id = _user_id(task, context, settings.output_path)
        memory.initialize(user_id)
        chunks = chunker(context.text, task.chunk_tokens)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        for chunk in chunks:
            memory.add(user_id, task.format_memory(chunk, timestamp))
        for query in pending:
            if query_limit is not None and processed_now >= query_limit:
                _summarize(document)
                write_json_atomic(settings.output_path, document)
                return document
            formatted_query = task.format_query(query.question)
            started = time.monotonic()
            wrapped_prompt = memory.wrap(user_id, formatted_query)
            prediction = chat.complete(
                SYSTEM_PROMPT, wrapped_prompt, task.generation_max_tokens
            )
            elapsed = time.monotonic() - started
            metrics = score_prediction(task, prediction, query.answers)
            row = {
                "context_id": context.ordinal,
                "qa_pair_id": query.qa_pair_id,
                "question_id": query.question_id,
                "question_type": query.question_type,
                "query": formatted_query,
                "output": prediction,
                "answer": list(query.answers),
                "metrics": metrics,
                "query_time_seconds": elapsed,
            }
            document["data"].append(row)
            processed_now += 1
            _summarize(document)
            write_json_atomic(settings.output_path, document)
    return document
