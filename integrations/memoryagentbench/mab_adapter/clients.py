from __future__ import annotations

import json
import time
from dataclasses import dataclass
from http.client import RemoteDisconnected
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class RemoteError(RuntimeError):
    pass


@dataclass(frozen=True)
class JsonHttpClient:
    base_url: str
    api_key: str | None = None
    timeout_seconds: float = 300.0
    retries: int = 3

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = path if path.startswith("http://") or path.startswith("https://") else (
            self.base_url.rstrip("/") + "/" + path.lstrip("/")
        )
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                request = Request(url, data=payload, headers=headers, method="POST")
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    value = json.loads(response.read().decode("utf-8"))
                if not isinstance(value, dict):
                    raise RemoteError(f"HTTP response from {url} is not an object")
                return value
            except HTTPError as error:
                last_error = RemoteError(f"HTTP {error.code} from {url}")
                retryable = error.code in {408, 409, 425, 429} or error.code >= 500
                if not retryable or attempt == self.retries:
                    raise last_error from error
            except (URLError, TimeoutError, RemoteDisconnected, json.JSONDecodeError) as error:
                last_error = error
                if attempt == self.retries:
                    break
            time.sleep(min(2**attempt, 8))
        raise RemoteError(f"Request failed for {url}") from last_error


@dataclass(frozen=True)
class MemoryClient:
    http: JsonHttpClient
    memory_system_name: str = "pimem"

    def initialize(self, user_id: str) -> None:
        value = self.http.post(
            "/memory/initialize",
            {"user_id": user_id, "memory_system_name": self.memory_system_name},
        )
        if value.get("status") != "ok" or value.get("user_id") != user_id:
            raise RemoteError("PiMem initialize response violates the contract")

    def add(self, user_id: str, chunk: str) -> None:
        value = self.http.post(
            "/memory/add",
            {
                "user_id": user_id,
                "memory_system_name": self.memory_system_name,
                "chunk": chunk,
            },
        )
        if value.get("status") != "ok" or value.get("user_id") != user_id:
            raise RemoteError("PiMem add response violates the contract")

    def wrap(self, user_id: str, question: str) -> str:
        value = self.http.post(
            "/memory/wrap_user_prompt",
            {
                "user_id": user_id,
                "memory_system_name": self.memory_system_name,
                "question": question,
            },
        )
        prompt = value.get("prompt")
        if value.get("status") != "ok" or not isinstance(prompt, str):
            raise RemoteError("PiMem wrap response violates the contract")
        return prompt


@dataclass(frozen=True)
class ChatClient:
    http: JsonHttpClient
    model: str

    def complete(self, system_prompt: str, prompt: str, max_tokens: int) -> str:
        value = self.http.post(
            "/chat/completions",
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
                "max_tokens": max_tokens,
            },
        )
        try:
            content = value["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise RemoteError("Chat completion response violates the contract") from error
        if not isinstance(content, str) or not content.strip():
            raise RemoteError("Chat completion returned an empty answer")
        return content.strip()
