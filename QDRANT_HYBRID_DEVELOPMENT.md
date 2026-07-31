# Qdrant Hybrid Retrieval Development

This work is isolated on `feature/qdrant-hybrid-retrieval`. It does not alter
the released `main`/`v1.0.0` line, and benchmark execution is not part of the
development stages below.

Each stage requires implementation, tests, an artifact or documented check,
and a dedicated commit before the next stage starts.

| Stage | Scope | Exit gate | Status |
| --- | --- | --- | --- |
| 1 | Extract the asynchronous dense-retriever boundary while retaining the exact SQLite implementation as the default | Existing ranking behavior and full repository checks pass | Complete (`npm run check`: 23 test files, 106 TypeScript tests, 5 Python tests, production build) |
| 2 | Add an internal Qdrant Server deployment, collection bootstrap, and strict scope/profile filtering | Health, persistence, idempotent upsert, and isolation integration tests pass | Complete (Qdrant `v1.15.5` server integration: health, restart persistence, idempotent bootstrap/upsert, strict scope isolation; `npm run check`: 24 test files, 112 TypeScript tests, 5 Python tests) |
| 3 | Add a transactional SQLite outbox, asynchronous batched synchronization, generation finalization, and a READY barrier | Crash resume and incomplete-generation rejection tests pass | In progress |
| 4 | Run FTS5 and Qdrant retrieval in parallel and preserve candidate-local BM25 plus RRF(k=60) | Lexical parity and ANN recall gates pass | Pending |
| 5 | Move synchronous SQLite retrieval/read/operator work off the Agent event loop into read-only workers | Event-loop and scope-isolation concurrency tests pass | Pending |
| 6 | Exercise failure, cancellation, stale-index, idempotency, provenance, and cross-scope cases | No partial-index search, scope leak, or provenance violation | Pending |
| 7 | Validate the complete service at 1/16/32/64/128 concurrent Search requests | 128-concurrency target passes with durable latency/error artifacts | Pending |

## Invariants

- SQLite remains the source of truth for immutable raw memories, embedding
  provenance, and deterministic rebuilds.
- Qdrant contains only a derived ANN index and minimal internal provenance.
- Agent-facing Search remains `operator`, `queries`, and optional `limit`.
- Exact IDs remain harness-owned.
- `Citations ⊆ Evidence ⊆ Candidates` remains mandatory.
- No question answer, gold evidence, rubric, or scoring information enters Add
  or vector indexing.
- A Qdrant generation must be `READY` before it can serve Search.
- Local benchmark databases and Qdrant storage remain physically isolated.
