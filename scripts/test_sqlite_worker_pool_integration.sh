#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SUFFIX="$$-${RANDOM}${RANDOM}"
VOLUME="pimem-sqlite-workers-${SUFFIX}"
NODE_IMAGE=${PIMEM_QDRANT_TEST_NODE_IMAGE:-node:22.19-bookworm-slim}

cleanup() {
  status=$?
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

docker volume create "$VOLUME" >/dev/null
docker run --rm \
  --mount "type=bind,src=${ROOT},dst=/workspace,readonly" \
  --mount "type=volume,src=${VOLUME},dst=/state" \
  --workdir /workspace \
  "$NODE_IMAGE" \
  node --disable-warning=ExperimentalWarning \
    scripts/sqlite_worker_pool_integration.mjs /state/memory.sqlite
