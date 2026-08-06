# LDBD deployment

PiMem exposes the synchronous LDBD memory contract without changing its retrieval core:

- `GET /health`
- `POST /v1/memories/add`
- `POST /v1/memories/search`

Build and start the container with secrets supplied only at runtime:

```bash
docker build -t pimem-ldbd:niko .
docker run --rm -p 8787:8787 \
  -v pimem-data:/data \
  -e OPENAI_API_BASE=https://provider.example/v1 \
  -e OPENAI_API_KEY=replace-at-runtime \
  -e PIMEM_API_TOKEN=replace-at-runtime \
  pimem-ldbd:niko
```

Use these LDBD settings:

```text
health:      http://HOST:8787/health
add:         http://HOST:8787/v1/memories/add
search:      http://HOST:8787/v1/memories/search
auth scheme: token
```

Add requests are persisted without any benchmark question or gold fields. On the first Search for a user, the complete set of that user's Add messages is materialized as one content-addressed immutable PiMem scope. Search runs the existing FTS5 Pi evidence agent and returns only its cited source memories. Repeated byte-identical Add requests are idempotent; reusing a request ID with different content is rejected.
