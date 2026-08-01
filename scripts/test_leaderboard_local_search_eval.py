from __future__ import annotations

import importlib.util
import json
import tempfile
import threading
import unittest
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

MODULE_PATH = Path(__file__).with_name("leaderboard_local_search_eval.py")
SPEC = importlib.util.spec_from_file_location("leaderboard_local_search_eval", MODULE_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


class FakeMemMachine:
    @staticmethod
    def _parse_timestamp(raw: str, session_index: int) -> datetime:
        return datetime(2024, 1, 1, tzinfo=timezone.utc)

    @staticmethod
    def _message_content(message: dict) -> str:
        return str(message.get("content", ""))


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def post(self, path: str, payload: dict, attempts: int) -> dict:
        self.calls.append((path, payload))
        if path.endswith("/add"):
            return {
                "success": True,
                "request_id": payload["request_id"],
                "user_id": payload["user_id"],
                "session_id": payload["session_id"],
            }
        return {
            "data": [
                {
                    "id": "pimem-package-test",
                    "content": json.dumps(
                        {
                            "type": "pimem_evidence_package_v1",
                            "status": "sufficient",
                            "evidence_summary": "Grounded source ledger.",
                            "citations": [],
                        }
                    ),
                    "score": 1,
                }
            ]
        }


class LeaderboardLocalSearchEvalTests(unittest.TestCase):
    def test_ingest_payload_contains_only_memory_contract_fields(self) -> None:
        record = SimpleNamespace(
            source_record_id="record-1",
            sessions=[
                (
                    "session-1",
                    "2024-01-01",
                    [
                        {"role": "user", "content": "Remember this source fact."},
                        {"role": "assistant", "content": "Acknowledged."},
                    ],
                )
            ],
            questions=[
                SimpleNamespace(
                    question="Benchmark question",
                    golden_answer="must never reach Add",
                )
            ],
        )
        registered = runner.RegisteredBenchmark(
            name="test_benchmark",
            source=SimpleNamespace(),
        )
        client = FakeClient()
        with tempfile.TemporaryDirectory() as root:
            runner.ingest_benchmark(
                FakeMemMachine(),
                registered,
                [record],
                client,
                "run-1",
                Path(root),
                attempts=1,
            )
        self.assertTrue(client.calls)
        for path, payload in client.calls:
            self.assertEqual(path, "/v1/memories/add")
            self.assertEqual(
                set(payload),
                {"request_id", "messages", "user_id", "session_id"},
            )
            serialized = json.dumps(payload)
            self.assertNotIn("Benchmark question", serialized)
            self.assertNotIn("must never reach Add", serialized)

    def test_search_artifact_excludes_all_evaluation_references(self) -> None:
        question = SimpleNamespace(
            source_question_id="question-1",
            question="Which source fact is relevant?",
            options=["A. First", "B. Second"],
            golden_answer="A",
            rubric=["Must choose A"],
            evidence=["gold evidence"],
        )
        record = SimpleNamespace(source_record_id="record-1", questions=[question])
        registered = runner.RegisteredBenchmark(
            name="test_benchmark",
            source=SimpleNamespace(),
        )
        client = FakeClient()
        with tempfile.TemporaryDirectory() as root:
            artifact = runner.search_benchmark(
                registered,
                [record],
                client,
                "run-1",
                Path(root),
                top_k=100,
                attempts=1,
                concurrency=1,
                max_questions_per_record=0,
            )
            row = json.loads(artifact.read_text().strip())
        self.assertEqual(row["status"], "ok")
        self.assertEqual(row["query"], question.question)
        self.assertEqual(row["options"], question.options)
        runner.assert_no_forbidden_keys(row)
        serialized = json.dumps(row)
        self.assertNotIn("Must choose A", serialized)
        self.assertNotIn("gold evidence", serialized)
        self.assertNotIn("golden_answer", serialized)

    def test_search_continuously_refills_free_slots(self) -> None:
        third_started = threading.Event()
        first_observed_third = threading.Event()

        class ContinuousClient(FakeClient):
            def post(self, path: str, payload: dict, attempts: int) -> dict:
                if path.endswith("/search"):
                    query = payload["query"]
                    if query == "question-3":
                        third_started.set()
                    elif query == "question-1":
                        if third_started.wait(timeout=1):
                            first_observed_third.set()
                return super().post(path, payload, attempts)

        questions = [
            SimpleNamespace(
                source_question_id=f"question-{index}",
                question=f"question-{index}",
                options=[],
            )
            for index in range(1, 4)
        ]
        record = SimpleNamespace(source_record_id="record-1", questions=questions)
        registered = runner.RegisteredBenchmark(
            name="test_benchmark",
            source=SimpleNamespace(),
        )
        with tempfile.TemporaryDirectory() as root:
            artifact = runner.search_benchmark(
                registered,
                [record],
                ContinuousClient(),
                "run-1",
                Path(root),
                top_k=100,
                attempts=1,
                concurrency=2,
                max_questions_per_record=0,
            )
            rows = [json.loads(line) for line in artifact.read_text().splitlines()]

        self.assertTrue(first_observed_third.is_set())
        self.assertEqual([row["query"] for row in rows], [
            "question-1",
            "question-2",
            "question-3",
        ])

    def test_chunking_respects_message_and_word_limits(self) -> None:
        messages = [
            {"role": "user", "content": "one two", "timestamp": index}
            for index in range(25)
        ]
        chunks = list(runner.chunk_messages(messages))
        self.assertEqual([len(chunk) for chunk in chunks], [20, 5])
        self.assertTrue(
            all(
                sum(runner.word_count(item["content"]) for item in chunk)
                <= runner.MAX_WORDS_PER_ADD
                for chunk in chunks
            )
        )


if __name__ == "__main__":
    unittest.main()
