#!/usr/bin/env python3
"""Run the pre-registered paired answer arm with durable checkpoints.

Provider failures retry the same immutable HTTP request indefinitely.  A
successful completion is accepted exactly once: ``attempts`` is therefore the
method-sampling count and is always one, while ``infrastructure_attempts``
separately records failed transports/provider responses before that success.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{threading.get_ident()}")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    fsync_directory(path.parent)


def append_event(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(path, 0o600)


def credentials(config_path: Path) -> tuple[str, str]:
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    generation = config["credentials"]["generation"]
    base_url = generation.get("base_url", generation.get("baseUrl"))
    api_key = generation.get("api_key", generation.get("apiKey"))
    if not isinstance(base_url, str) or not isinstance(api_key, str):
        raise ValueError("Generation credentials are incomplete")
    return base_url.rstrip("/"), api_key


class RetryableProviderError(RuntimeError):
    def __init__(
        self, code: str, *, status: int | None = None
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def answer_http_once(
    *, base_url: str, api_key: str, body: bytes, timeout: float
) -> tuple[str, str, dict[str, Any] | None]:
    request = Request(
        base_url + "/chat/completions",
        data=body,
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {408, 409, 425, 429} or error.code >= 500:
            raise RetryableProviderError(
                f"http_{error.code}", status=error.code
            ) from error
        raise RuntimeError(f"non-retryable HTTP {error.code}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RetryableProviderError(type(error).__name__) from error
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RetryableProviderError("malformed_completion") from error
    if not isinstance(content, str) or not content.strip():
        raise RetryableProviderError("empty_completion")
    model = payload.get("model")
    usage = payload.get("usage")
    return (
        content.strip(),
        model if isinstance(model, str) else "gpt-5-mini",
        usage if isinstance(usage, dict) else None,
    )


def request_body(contract: dict[str, Any], prompt: str) -> bytes:
    return json.dumps(
        {
            "model": contract["model"],
            "messages": [
                {"role": "system", "content": contract["system_prompt"]},
                {"role": "user", "content": prompt},
            ],
            "reasoning_effort": contract["thinking_level"],
            "max_completion_tokens": contract["max_completion_tokens"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--runtime-source", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        raise ValueError("workers must be in [1, 32]")
    experiment = args.experiment.resolve()
    source_root = args.source_root.resolve()
    runtime_source = args.runtime_source.resolve()
    manifest_path = experiment / "PREPARATION_MANIFEST.json"
    manifest = read_json(manifest_path)
    preparation_path = Path(manifest["preparation"])
    if sha256_file(preparation_path) != manifest["preparation_sha256"]:
        raise ValueError("Preparation hash changed")
    preparation = read_json(preparation_path)
    if (
        manifest.get("status") != "PREPARED_AWAITING_APPROVAL_NO_MODEL_CALLS"
        or preparation["selection"].get("wrong_only_filter_applied") is not False
        or preparation["selection"].get("candidate_stage_count") != 58
        or preparation["selection"].get("guard_sample_count") != 40
        or len(preparation["rows"]) != 98
        or len(preparation["schedule"]["units"]) != 196
    ):
        raise ValueError("Corrected A/B preparation contract is incomplete")
    if preparation["claim_boundary"]["evidence_selection_uses_gold"] is not False:
        raise ValueError("B evidence selection is not registered gold-free")
    prelaunch = read_json(source_root / "PRELAUNCH_MANIFEST.json")
    if sha256_file(args.config) != prelaunch["config"]["sha256"]:
        raise ValueError("Secure generation config changed after the frozen E0 run")
    base_url, api_key = credentials(args.config)
    artifact = read_json(
        source_root
        / "runs/e0-auto-handoff-formal-full300-run1/longmemeval-s-static.json"
    )
    if artifact["answer_base_url"].rstrip("/") != base_url:
        raise ValueError("Answer endpoint differs from the frozen run")

    sys.path.insert(0, str(runtime_source / "integrations/memoryagentbench"))
    from mab_adapter.load_control import (  # pylint: disable=import-outside-toplevel
        AdaptiveConcurrencyConfig,
        AdaptiveConcurrencyController,
    )

    contract = preparation["answer_contract"]
    rows = {row["benchmark_query_id"]: row for row in preparation["rows"]}
    schedule = preparation["schedule"]["units"]
    results_path = experiment / "answers/answer-results.json"
    events_path = experiment / "answers/infrastructure-events.jsonl"
    lock = threading.Lock()
    if results_path.exists():
        results = read_json(results_path)
        if results.get("preparation_sha256") != manifest["preparation_sha256"]:
            raise ValueError("Answer checkpoint belongs to another preparation")
    else:
        results = {
            "schema_version": 1,
            "status": "answers_in_progress",
            "experiment": preparation["experiment"],
            "preparation_sha256": manifest["preparation_sha256"],
            "config_sha256": sha256_file(args.config),
            "answer_contract": contract,
            "sampling_semantics": {
                "successful_output_attempts": 1,
                "successful_output_discarded": False,
                "provider_infrastructure_recovery": "unbounded exact-request retry",
                "infrastructure_attempts_recorded_separately": True,
            },
            "scheduler": {
                "workers": args.workers,
                "schedule_seed": preparation["schedule"]["seed"],
                "durability": "atomic replace + file fsync + directory fsync after every successful unit",
            },
            "rows": [],
        }
        write_json(results_path, results)
    completed = {
        (row["benchmark_query_id"], row["arm"]): row for row in results["rows"]
    }
    if len(completed) != len(results["rows"]):
        raise ValueError("Answer checkpoint contains duplicate units")
    for key, row in completed.items():
        prepared = rows[key[0]]
        prompt = (
            prepared["a_prompt"]
            if key[1] == "a_current_exact_read"
            else prepared["b_prompt"]
        )
        body = request_body(contract, prompt)
        if (
            row.get("prompt_sha256") != sha256_text(prompt)
            or row.get("request_sha256") != sha256_bytes(body)
            or row.get("attempts") != 1
            or not isinstance(row.get("output"), str)
            or not row["output"].strip()
        ):
            raise ValueError("Answer checkpoint row identity or attempt semantics changed")

    adaptive_config = AdaptiveConcurrencyConfig(
        minimum=1, initial=min(4, args.workers), maximum=args.workers,
        successes_per_increase=8,
    )
    controller = AdaptiveConcurrencyController(
        adaptive_config,
        results.get("adaptive_state"),
    )
    pending = [
        unit
        for unit in schedule
        if (unit["benchmark_query_id"], unit["arm"]) not in completed
    ]

    def execute(unit: dict[str, Any]) -> dict[str, Any]:
        prepared = rows[unit["benchmark_query_id"]]
        prompt = (
            prepared["a_prompt"]
            if unit["arm"] == "a_current_exact_read"
            else prepared["b_prompt"]
        )
        prompt_hash = sha256_text(prompt)
        body = request_body(contract, prompt)
        body_hash = sha256_bytes(body)
        infrastructure_attempts = 0
        failures: list[dict[str, Any]] = []
        started = time.monotonic()
        while True:
            infrastructure_attempts += 1
            lease = controller.acquire()
            assert lease is not None
            try:
                output, response_model, usage = answer_http_once(
                    base_url=base_url,
                    api_key=api_key,
                    body=body,
                    timeout=120.0,
                )
            except RetryableProviderError as error:
                controller.failed(
                    lease,
                    "answer",
                    retryable=True,
                    http_status=error.status,
                    error_code=error.code,
                )
                failure = {
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "benchmark_query_id": unit["benchmark_query_id"],
                    "arm": unit["arm"],
                    "request_sha256": body_hash,
                    "infrastructure_attempt": infrastructure_attempts,
                    "error_code": error.code,
                    **({"http_status": error.status} if error.status is not None else {}),
                }
                failures.append(failure)
                with lock:
                    append_event(events_path, failure)
                delay = min(2 ** min(infrastructure_attempts - 1, 5), 30)
                time.sleep(delay + random.random() * min(1.0, delay / 4))
                continue
            except BaseException:
                controller.failed(lease, "answer", retryable=False)
                raise
            controller.succeeded(lease, "answer")
            result = {
                **unit,
                "group": prepared["group"],
                "current_judge_correct": prepared["current_judge_correct"],
                "prompt_sha256": prompt_hash,
                "request_sha256": body_hash,
                "output": output,
                "response_model": response_model,
                "usage": usage,
                "attempts": 1,
                "infrastructure_attempts": infrastructure_attempts,
                "infrastructure_failure_count": len(failures),
                "elapsed_seconds": time.monotonic() - started,
            }
            with lock:
                results["rows"].append(result)
                results["rows"].sort(key=lambda value: value["schedule_index"])
                results["adaptive_state"] = controller.snapshot()
                results["completed_units"] = len(results["rows"])
                write_json(results_path, results)
                done = len(results["rows"])
            if done % 10 == 0 or done == len(schedule):
                print(
                    json.dumps(
                        {"completed": done, "total": len(schedule), "adaptive": controller.snapshot()},
                        separators=(",", ":"),
                    ),
                    flush=True,
                )
            return result

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(execute, unit) for unit in pending]
        for future in as_completed(futures):
            future.result()
    final = read_json(results_path)
    expected_keys = {
        (unit["benchmark_query_id"], unit["arm"]) for unit in schedule
    }
    actual_keys = {
        (row["benchmark_query_id"], row["arm"]) for row in final["rows"]
    }
    if actual_keys != expected_keys or len(final["rows"]) != 196:
        raise ValueError("Paired answer output is incomplete")
    if any(row.get("attempts") != 1 for row in final["rows"]):
        raise ValueError("A successful answer was resampled")
    final["status"] = "answers_complete_judge_pending"
    final["attempt_audit"] = {
        "successful_outputs": len(final["rows"]),
        "all_successful_output_attempts_equal_one": True,
        "total_infrastructure_attempts": sum(
            row["infrastructure_attempts"] for row in final["rows"]
        ),
        "units_with_infrastructure_recovery": sum(
            row["infrastructure_attempts"] > 1 for row in final["rows"]
        ),
        "successful_output_discarded": False,
    }
    write_json(results_path, final)

    source_rows = {row["benchmark_query_id"]: row for row in artifact["data"]}
    judge_rows: list[dict[str, Any]] = []
    for result in final["rows"]:
        source = source_rows[result["benchmark_query_id"]]
        judge_rows.append(
            {
                "schedule_index": result["schedule_index"],
                "pair_index": result["pair_index"],
                "benchmark_query_id": result["benchmark_query_id"],
                "arm": result["arm"],
                "group": result["group"],
                "current_judge_correct": result["current_judge_correct"],
                "question_id": source["question_id"],
                "question_type": source["question_type"],
                "query": source["query"],
                "answer": source["answer"],
                "output": result["output"],
                "source_prediction_sha256": sha256_text(result["output"]),
            }
        )
    judge_input = {
        "schema_version": 1,
        "status": "judge_pending",
        "experiment": preparation["experiment"],
        "preparation_sha256": manifest["preparation_sha256"],
        "answer_results": str(results_path),
        "answer_results_sha256": sha256_file(results_path),
        "judge_contract": preparation["judge_contract"],
        "rows": sorted(judge_rows, key=lambda value: value["schedule_index"]),
    }
    judge_input_path = experiment / "judge-input/paired-answers.json"
    write_json(judge_input_path, judge_input)
    run_manifest = {
        "schema_version": 1,
        "status": "answers_complete_judge_pending",
        "preparation_sha256": manifest["preparation_sha256"],
        "answer_results": str(results_path),
        "answer_results_sha256": sha256_file(results_path),
        "judge_input": str(judge_input_path),
        "judge_input_sha256": sha256_file(judge_input_path),
        "attempt_audit": final["attempt_audit"],
        "adaptive_state": final["adaptive_state"],
    }
    write_json(experiment / "RUN_MANIFEST.json", run_manifest)
    print(json.dumps(run_manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
