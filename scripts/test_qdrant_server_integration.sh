#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SUFFIX="$$-${RANDOM}${RANDOM}"
CONTAINER="pimem-qdrant-integration-${SUFFIX}"
NETWORK="pimem-qdrant-integration-${SUFFIX}"
VOLUME="pimem-qdrant-integration-${SUFFIX}"
QDRANT_IMAGE=${PIMEM_QDRANT_IMAGE:-qdrant/qdrant@sha256:0fb8897412abc81d1c0430a899b9a81eb8328aa634e7242d1bc804c1fe8fe863}
NODE_IMAGE=${PIMEM_QDRANT_TEST_NODE_IMAGE:-node:22.19-bookworm-slim}

cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    docker logs "$CONTAINER" 2>&1 | tail -200 >&2 || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

docker network create "$NETWORK" >/dev/null
docker volume create "$VOLUME" >/dev/null

start_qdrant() {
  docker run --detach \
    --name "$CONTAINER" \
    --network "$NETWORK" \
    --env QDRANT__TELEMETRY_DISABLED=true \
    --mount "type=volume,src=${VOLUME},dst=/qdrant/storage" \
    "$QDRANT_IMAGE" >/dev/null
}

run_client() {
  phase=$1
  docker run --rm \
    --network "$NETWORK" \
    --mount "type=bind,src=${ROOT},dst=/workspace,readonly" \
    --workdir /workspace \
    "$NODE_IMAGE" \
    node scripts/qdrant_integration_client.mjs "$phase" "http://${CONTAINER}:6333"
}

start_qdrant
seed_result=$(run_client seed)
docker rm -f "$CONTAINER" >/dev/null
start_qdrant
verify_result=$(run_client verify)

printf '{\n'
printf '  "image": "%s",\n' "$QDRANT_IMAGE"
printf '  "health": "ok",\n'
printf '  "collectionBootstrap": "idempotent",\n'
printf '  "pointUpsert": "idempotent",\n'
printf '  "strictScopeIsolation": "ok",\n'
printf '  "persistenceAfterRestart": "ok",\n'
printf '  "phases": [%s, %s]\n' "$seed_result" "$verify_result"
printf '}\n'
