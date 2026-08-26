from __future__ import annotations

import argparse
import os
from pathlib import Path

from .artifacts import read_json, write_json_atomic
from .clients import ChatClient, JsonHttpClient, MemoryClient
from .config import TASKS, task_config
from .dataset import download_data_file, load_contexts, verify_data_file, data_path
from .runner import RunSettings, execute_run
from .scoring import score_prediction


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Standalone PiMem MemoryAgentBench adapter")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list supported first-wave tasks")
    for name in ("download", "validate"):
        command = commands.add_parser(name)
        command.add_argument("--task", action="append", choices=tuple(TASKS))
        command.add_argument("--data-dir", type=Path, default=Path("data"))
    run = commands.add_parser("run")
    run.add_argument("--task", required=True, choices=tuple(TASKS))
    run.add_argument("--data-dir", type=Path, default=Path("data"))
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--memory-base-url", default="http://127.0.0.1:3111")
    run.add_argument("--memory-system-name", default="pimem")
    run.add_argument("--answer-base-url", required=True)
    run.add_argument("--answer-model", required=True)
    run.add_argument("--answer-api-key-env", default="OPENAI_API_KEY")
    run.add_argument("--max-contexts", type=int)
    run.add_argument("--max-queries", type=int)
    run.add_argument("--resume", action="store_true")
    score = commands.add_parser("score")
    score.add_argument("--input", type=Path, required=True)
    return parser


def _selected(values: list[str] | None) -> list[str]:
    return values if values else list(TASKS)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "list":
        for task in TASKS.values():
            print(
                f"{task.task_id}\t{task.capability}\t{task.source}\t"
                f"{task.expected_contexts} contexts/{task.expected_questions} questions\t"
                f"{task.official_metric}"
            )
        return 0
    if args.command == "download":
        for task_id in _selected(args.task):
            task = task_config(task_id)
            print(download_data_file(args.data_dir, task))
        return 0
    if args.command == "validate":
        for task_id in _selected(args.task):
            task = task_config(task_id)
            verify_data_file(data_path(args.data_dir, task), task)
            contexts = load_contexts(args.data_dir, task)
            print(f"{task_id}: {len(contexts)} contexts, {sum(len(c.queries) for c in contexts)} questions")
        return 0
    if args.command == "score":
        document = read_json(args.input)
        task = task_config(document["task"])
        for row in document["data"]:
            row["metrics"] = score_prediction(task, row["output"], row["answer"])
        names = {name for row in document["data"] for name in row["metrics"]}
        document["metrics"] = {
            name: (
                sum(values) / len(values)
                if (values := [row["metrics"][name] for row in document["data"] if row["metrics"].get(name) is not None])
                else None
            )
            for name in sorted(names)
        }
        write_json_atomic(args.input, document)
        print(args.input)
        return 0
    task = task_config(args.task)
    contexts = load_contexts(args.data_dir, task)
    memory = MemoryClient(
        JsonHttpClient(args.memory_base_url),
        memory_system_name=args.memory_system_name,
    )
    api_key = os.environ.get(args.answer_api_key_env)
    chat = ChatClient(JsonHttpClient(args.answer_base_url, api_key=api_key), args.answer_model)
    result = execute_run(
        task,
        contexts,
        memory,
        chat,
        RunSettings(
            output_path=args.output,
            max_contexts=args.max_contexts,
            max_queries=args.max_queries,
            resume=args.resume,
        ),
    )
    print(f"wrote {result['completed_queries']} predictions to {args.output}")
    return 0
