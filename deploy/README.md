# Leaderboard API deployment

PiMem exposes the synchronous Leaderboard memory contract on the existing service port:

- `GET /health`
- `POST /v1/memories/add`
- `POST /v1/memories/search`

The HTTP entrypoint delegates to an application service. The application service uses the memory and retrieval domain ports; SQLite and the Pi provider are infrastructure adapters.

## Lifecycle

Each `user_id` maps to one stable, opaque PiMem scope. Add appends immutable source messages directly to SQLite and completes only after FTS5 and embedding indexing are complete. Repeating the same `request_id` and payload is idempotent; conflicting reuse returns `409`.

The first Search atomically seals the user's scope. Search fails closed while an Add is incomplete, and every later Add for that user returns `409`. Search uses the configured hybrid retrieval profile and returns only immutable raw memories cited by the evidence agent. It never returns benchmark questions, Gold fields, retrieval traces, ranks, or synthetic scores.

Set `PIMEM_RETRIEVAL_PROFILE=pimem-hybrid-qdrant-hnsw-v1` plus the Qdrant
variables documented in the root README to use filtered HNSW. The configured
`PIMEM_VECTOR_GENERATION_ID` is a run-level base ID; the service derives one
immutable generation per scope and corpus fingerprint. Qdrant contains vectors
and provenance only. SQLite remains the source of raw text and revalidates every
returned point before it becomes a candidate.

## Container

Secrets are supplied only at runtime. Persist all model/cache and PiMem data under `/data`.

```bash
docker build -t pimem-ldbd:replacement .
docker run --rm -p 18088:8787 \
  -v /data/zhaogangyi/pi-mem-live/leaderboard-live-v2:/data \
  --env-file /home/zhaogangyi/.config/pi-mem/embedding.env \
  --env-file /home/zhaogangyi/.config/pi-mem/answer.env \
  -e PIMEM_API_TOKEN= \
  pimem-ldbd:replacement
```

The public service intentionally permits unauthenticated HTTP when `PIMEM_API_TOKEN` is unset. When set, Token, Bearer, and `x-api-key` headers are accepted.

Default runtime policy:

```text
container port:    8787
host replacement: 18088
Add concurrency:  8
Search concurrency: 16
retrieval:         pimem-hybrid
maxPerSession:     unset
model:             gpt-4o-mini
transport:         non-stream with actual-response-model validation
```
