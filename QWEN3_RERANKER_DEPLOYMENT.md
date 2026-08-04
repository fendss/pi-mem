# Qwen3 4B Reranker Deployment

## Boundary

The reranker is an opt-in deterministic ranking sidecar. SQLite remains the immutable source of truth, Qdrant remains a disposable ANN sidecar, and the Agent-facing Search schema is unchanged. The reranker may reorder candidates but cannot create memories, source IDs, evidence, or citations.

Production PiMem remains on image `pimem-qdrant:4030d64` without reranking. The deployed model service is used only by an isolated candidate PiMem service until acceptance is complete.

## Model service

```text
model:    Qwen/Qwen3-Reranker-4B
revision: 22e683669bc0f0bd69640a1354a6d0aebcfeede5
backend:  vLLM continuous batching, deterministic yes/no logit scoring
dtype:    bfloat16
GPU:      physical GPU 4 / NVIDIA H200
GPU UUID: GPU-1eb8c67a-72a2-89cf-b65b-9ddb0fd3be1e
context:  1024 tokens per query/document pair
```

The server uses the official Qwen yes/no prompt contract and a PiMem instruction that asks for direct evidence rather than merely topical similarity. It returns one probability for every submitted immutable memory ID.

Deployment paths:

```text
/data/zhaogangyi/pi-mem-reranker/
/data/zhaogangyi/pi-mem-reranker/models/Qwen3-Reranker-4B/
/data/zhaogangyi/pi-mem-reranker/MODEL_MANIFEST.json
/home/zhaogangyi/.local/bin/run-pimem-qwen3-reranker
/home/zhaogangyi/.config/systemd/user/pimem-qwen3-reranker.service
```

The model is pinned by revision and file SHA-256 hashes. Startup hashes every manifested model file before loading, and responses expose the verified manifest SHA-256 for fail-closed client verification. Model files and artifacts are mode `0600`; directories are mode `0700`. The cache and model are under `/data`, not the nearly full root filesystem.

The endpoint is not publicly exposed:

```text
host diagnostic: http://127.0.0.1:18090
Docker network:  http://pimem-qwen3-reranker:8090
```

Operations:

```bash
systemctl --user status pimem-qwen3-reranker.service
curl -fsS http://127.0.0.1:18090/health
journalctl --user -u pimem-qwen3-reranker.service -n 100 --no-pager
```

## PiMem integration

Enable the sidecar only when all variables are set in a candidate deployment:

```text
PIMEM_RERANKER_BASE_URL=http://pimem-qwen3-reranker:8090
PIMEM_RERANKER_MODEL=Qwen/Qwen3-Reranker-4B
PIMEM_RERANKER_REVISION=22e683669bc0f0bd69640a1354a6d0aebcfeede5
PIMEM_RERANKER_MANIFEST_SHA256=11159710006fbde455370d2bdd4b8d5d46620c14631d3f8c30781ee83ce4652f
PIMEM_RERANKER_CANDIDATE_LIMIT=100
PIMEM_RERANKER_TIMEOUT_MS=120000
```

For every Agent-planned hybrid query, PiMem:

1. obtains dense, FTS5, and candidate-local BM25 rankings;
2. fuses them with the existing `RRF(k=60)` contract;
3. submits at most the top 100 fused candidates to the reranker;
4. orders the scored pool by Qwen probability, using the existing fused order as a deterministic tie-breaker;
5. applies the existing limit, session cap, provenance ledger, Read boundary, and cited-only projection.

The client fails closed on HTTP errors, timeouts, missing IDs, duplicate IDs, invalid probabilities, model substitution, revision substitution, or model-manifest substitution. Lexical-only search remains lexical-only.

## Acceptance

Service canaries:

```text
2 documents: positive evidence ranked first
100 short documents: target evidence ranked first
16 concurrent requests: 0 errors
```

A gold-blind, fixed 100-question Search experiment completed `100/100` with no retries. Gold was joined only after Search completed; no Answer or Judge calls were made.

| Metric | v6 without reranker | v6 + Qwen3 reranker |
|---|---:|---:|
| Candidate near-1 group recall | 49.90% | 52.40% |
| Read near-1 group recall | 32.65% | 32.00% |
| Cited near-1 group recall | 21.15% | 23.00% |
| Candidate-complete questions | 66.67% | 68.89% |
| Read-complete questions | 41.11% | 45.56% |
| Cited-complete questions | 25.56% | 32.22% |
| Abstention marked sufficient | 9/10 | 8/10 |

The reranker improves final cited coverage and evidence-complete questions, but the gain is not yet large enough to justify enabling it in production without a larger latency and quality acceptance.

Artifacts:

```text
/data/zhaogangyi/pi-mem-reranker/RETRIEVAL_QWEN3_RERANKER_100_RESULT.json
/data/zhaogangyi/pi-mem-reranker/request-results-reranker-100.jsonl
/data/zhaogangyi/pi-mem-reranker/artifacts-v2/
```
