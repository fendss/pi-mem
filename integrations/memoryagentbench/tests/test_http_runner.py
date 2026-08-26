from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from dataclasses import replace
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mab_adapter.clients import ChatClient, JsonHttpClient, MemoryClient  # noqa: E402
from mab_adapter.config import task_config  # noqa: E402
from mab_adapter.contracts import Context, Query  # noqa: E402
from mab_adapter.runner import RunSettings, execute_run  # noqa: E402


class MockHandler(BaseHTTPRequestHandler):
    chunks: dict[str, list[str]] = {}
    paths: list[str] = []

    def log_message(self, *_args):
        pass

    def do_POST(self):
        length = int(self.headers["content-length"])
        body = json.loads(self.rfile.read(length))
        type(self).paths.append(self.path)
        if self.path == "/memory/initialize":
            type(self).chunks[body["user_id"]] = []
            response = {
                "status": "ok",
                "user_id": body["user_id"],
                "memory_system_name": body["memory_system_name"],
            }
        elif self.path == "/memory/add":
            type(self).chunks[body["user_id"]].append(body["chunk"])
            response = {"status": "ok", "user_id": body["user_id"], "response": None}
        elif self.path == "/memory/wrap_user_prompt":
            memories = "\n".join(type(self).chunks[body["user_id"]])
            response = {
                "status": "ok",
                "user_id": body["user_id"],
                "prompt": f"<memory_context>{memories}</memory_context>\nUser: {body['question']}",
            }
        elif self.path == "/chat/completions":
            self.__class__.last_chat_body = body
            response = {"choices": [{"message": {"content": "France"}}]}
        else:
            self.send_error(404)
            return
        payload = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class HttpRunnerTests(unittest.TestCase):
    def setUp(self):
        MockHandler.chunks = {}
        MockHandler.paths = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_complete_black_box_run(self):
        task = replace(task_config("ruler-qa1"), expected_contexts=1, expected_questions=1)
        contexts = (
            Context(
                ordinal=0,
                text="Normandy is in France.",
                queries=(
                    Query(
                        question="Where is Normandy?",
                        answers=("France",),
                        qa_pair_id="qa-1",
                        question_id=None,
                        question_type=None,
                    ),
                ),
            ),
        )
        http = JsonHttpClient(self.base_url, retries=0)
        memory = MemoryClient(http)
        chat = ChatClient(http, "mock-model")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            document = execute_run(
                task,
                contexts,
                memory,
                chat,
                RunSettings(output_path=output),
                chunker=lambda text, _size: [text],
            )
            persisted = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(document["completed_queries"], 1)
        self.assertEqual(persisted["metrics"]["official_score"], 1.0)
        self.assertEqual(
            MockHandler.paths,
            [
                "/memory/initialize",
                "/memory/add",
                "/memory/wrap_user_prompt",
                "/chat/completions",
            ],
        )
        chat_prompt = MockHandler.last_chat_body["messages"][1]["content"]
        self.assertIn("Normandy is in France", chat_prompt)
        self.assertNotIn('"answer"', json.dumps(MockHandler.last_chat_body).lower())

    def test_all_ten_tasks_complete_over_the_http_boundary(self):
        for task_id in (
            "ruler-qa1",
            "longmemeval-s",
            "trec-coarse",
            "trec-fine",
            "banking77",
            "nlu",
            "clinic150",
            "fact-sh-6k",
            "fact-mh-6k",
            "eventqa-64k",
        ):
            with self.subTest(task=task_id):
                MockHandler.chunks = {}
                MockHandler.paths = []
                task = replace(
                    task_config(task_id), expected_contexts=1, expected_questions=1
                )
                contexts = (
                    Context(
                        ordinal=0,
                        text="Normandy is in France.",
                        queries=(
                            Query(
                                question="Where is Normandy?",
                                answers=("France",),
                                qa_pair_id=f"{task_id}-qa-1",
                                question_id="question-1",
                                question_type="multi-session",
                            ),
                        ),
                    ),
                )
                http = JsonHttpClient(self.base_url, retries=0)
                with tempfile.TemporaryDirectory() as directory:
                    document = execute_run(
                        task,
                        contexts,
                        MemoryClient(http),
                        ChatClient(http, "mock-model"),
                        RunSettings(output_path=Path(directory) / f"{task_id}.json"),
                        chunker=lambda text, _size: [text],
                    )
                self.assertEqual(document["completed_queries"], 1)
                self.assertEqual(
                    MockHandler.paths,
                    [
                        "/memory/initialize",
                        "/memory/add",
                        "/memory/wrap_user_prompt",
                        "/chat/completions",
                    ],
                )

    def test_resume_rejects_changed_run_identity(self):
        task = replace(task_config("ruler-qa1"), expected_contexts=1, expected_questions=1)
        contexts = (
            Context(
                ordinal=0,
                text="Normandy is in France.",
                queries=(
                    Query(
                        question="Where is Normandy?",
                        answers=("France",),
                        qa_pair_id="qa-1",
                        question_id=None,
                        question_type=None,
                    ),
                ),
            ),
        )
        http = JsonHttpClient(self.base_url, retries=0)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result.json"
            execute_run(
                task,
                contexts,
                MemoryClient(http),
                ChatClient(http, "model-a"),
                RunSettings(output_path=output),
                chunker=lambda text, _size: [text],
            )
            with self.assertRaisesRegex(ValueError, "answer_model"):
                execute_run(
                    task,
                    contexts,
                    MemoryClient(http),
                    ChatClient(http, "model-b"),
                    RunSettings(output_path=output, resume=True),
                    chunker=lambda text, _size: [text],
                )

    @patch("mab_adapter.clients.time.sleep", return_value=None)
    @patch("mab_adapter.clients.urlopen")
    def test_retries_remote_disconnect(self, mocked_urlopen, _mocked_sleep):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"status":"ok"}'
        mocked_urlopen.side_effect = [
            RemoteDisconnected("upstream closed the connection"),
            response,
        ]

        value = JsonHttpClient("https://example.invalid", retries=1).post(
            "/endpoint", {"value": 1}
        )

        self.assertEqual(value, {"status": "ok"})
        self.assertEqual(mocked_urlopen.call_count, 2)


if __name__ == "__main__":
    unittest.main()
