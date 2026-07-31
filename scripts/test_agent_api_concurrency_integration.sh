#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SUFFIX="$$-${RANDOM}${RANDOM}"
QDRANT_CONTAINER="pimem-qdrant-agent-load-${SUFFIX}"
NETWORK="pimem-agent-load-${SUFFIX}"
QDRANT_VOLUME="pimem-qdrant-agent-load-${SUFFIX}"
STATE_VOLUME="pimem-agent-load-${SUFFIX}"
QDRANT_IMAGE=${PIMEM_QDRANT_IMAGE:-qdrant/qdrant@sha256:0fb8897412abc81d1c0430a899b9a81eb8328aa634e7242d1bc804c1fe8fe863}
PIMEM_IMAGE=${PIMEM_AGENT_LOAD_IMAGE:-pimem-qdrant-dev:stage7}

cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    docker logs "$QDRANT_CONTAINER" 2>&1 | tail -200 >&2 || true
  fi
  docker rm -f "$QDRANT_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker volume rm -f "$QDRANT_VOLUME" >/dev/null 2>&1 || true
  docker volume rm -f "$STATE_VOLUME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

docker network create "$NETWORK" >/dev/null
docker volume create "$QDRANT_VOLUME" >/dev/null
docker volume create "$STATE_VOLUME" >/dev/null
docker run --detach \
  --name "$QDRANT_CONTAINER" \
  --network "$NETWORK" \
  --env QDRANT__TELEMETRY_DISABLED=true \
  --mount "type=volume,src=${QDRANT_VOLUME},dst=/qdrant/storage" \
  "$QDRANT_IMAGE" >/dev/null

docker run --rm \
  --network "$NETWORK" \
  --mount "type=bind,src=${ROOT}/scripts/agent_api_concurrency_integration.mjs,dst=/app/scripts/agent_api_concurrency_integration.mjs,readonly" \
  --mount "type=volume,src=${STATE_VOLUME},dst=/data" \
  --workdir /app \
  --entrypoint node \
  "$PIMEM_IMAGE" \
  --disable-warning=ExperimentalWarning \
  scripts/agent_api_concurrency_integration.mjs \
  "http://${QDRANT_CONTAINER}:6333" /data/memory.sqlite
