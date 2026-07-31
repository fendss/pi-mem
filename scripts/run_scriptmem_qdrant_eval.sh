#!/usr/bin/env bash
# Run all registered ScriptMem sources with the 128-slot Qdrant service and
# preserve both leaderboard Search products and private Agent audit artifacts.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/leaderboard_local_search_eval.py"
INDEXER="${SCRIPT_DIR}/index_agent_search_artifacts.py"
RUN_ID="${1:-pimem-scriptmem-qdrant-$(date -u +%Y%m%dT%H%M%SZ)}"
MEMMACHINE_ROOT="${MEMMACHINE_ROOT:-/home/zhaogangyi/MemMachine}"
OUTPUT_ROOT="${PIMEM_SCRIPTMEM_OUTPUT_ROOT:-/data/zhaogangyi/pi-mem-eval}"
IMAGE="${PIMEM_SCRIPTMEM_IMAGE:-pimem-qdrant-dev:scriptmem}"
QDRANT_IMAGE="${PIMEM_QDRANT_IMAGE:-qdrant/qdrant@sha256:0fb8897412abc81d1c0430a899b9a81eb8328aa634e7242d1bc804c1fe8fe863}"
PORT="${PIMEM_SCRIPTMEM_PORT:-19088}"
SEARCH_CONCURRENCY="${PIMEM_SCRIPTMEM_SEARCH_CONCURRENCY:-128}"
TOP_K="${PIMEM_SCRIPTMEM_TOP_K:-100}"
ATTEMPTS="${PIMEM_SCRIPTMEM_ATTEMPTS:-3}"
MAX_RECORDS="${PIMEM_SCRIPTMEM_MAX_RECORDS:-0}"
MAX_QUESTIONS="${PIMEM_SCRIPTMEM_MAX_QUESTIONS_PER_RECORD:-0}"
BENCHMARKS=(scriptmem_man_earth scriptmem_enemy scriptmem_angry scriptmem_friends)

if [[ "$SEARCH_CONCURRENCY" != 128 ]]; then
  echo "ScriptMem acceptance requires exactly 128 Search slots" >&2
  exit 2
fi
if [[ -n "${PIMEM_SCRIPTMEM_BENCHMARKS:-}" ]]; then
  IFS=',' read -r -a BENCHMARKS <<<"${PIMEM_SCRIPTMEM_BENCHMARKS}"
fi

umask 077
run_root="${OUTPUT_ROOT}/${RUN_ID}"
mkdir -p "$run_root"
chmod 700 "$OUTPUT_ROOT" "$run_root"
set -a
. /home/zhaogangyi/.config/pi-mem/embedding.env
. /home/zhaogangyi/.config/pi-mem/answer.env
set +a

server="pimem-scriptmem-api"
qdrant="pimem-scriptmem-qdrant"
network="pimem-scriptmem-net"
cleanup() {
  docker rm -f "$server" "$qdrant" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for benchmark in "${BENCHMARKS[@]}"; do
  case "$benchmark" in
    scriptmem_man_earth|scriptmem_enemy|scriptmem_angry|scriptmem_friends) ;;
    *) echo "Unsupported ScriptMem registration: $benchmark" >&2; exit 2 ;;
  esac
  benchmark_root="${run_root}/${benchmark}"
  sqlite_dir="${benchmark_root}/storage/sqlite"
  qdrant_dir="${benchmark_root}/storage/qdrant"
  artifact_dir="${benchmark_root}/agent-artifacts"
  mkdir -p "$sqlite_dir" "$qdrant_dir" "$artifact_dir"
  chmod 700 "$benchmark_root" "${benchmark_root}/storage" \
    "$sqlite_dir" "$qdrant_dir" "$artifact_dir"
  printf '{"schema_version":"pimem-scriptmem-storage/v1","benchmark":"%s","run_id":"%s","sqlite":"%s/memory.sqlite","qdrant":"%s","search_slots":128,"sqlite_workers":128}\n' \
    "$benchmark" "$RUN_ID" "$sqlite_dir" "$qdrant_dir" \
    >"${benchmark_root}/database.json"
  chmod 600 "${benchmark_root}/database.json"

  cleanup
  docker network create "$network" >/dev/null
  docker run -d --name "$qdrant" --network "$network" \
    --log-opt max-size=20m --log-opt max-file=3 \
    -e QDRANT__TELEMETRY_DISABLED=true \
    --mount "type=bind,src=${qdrant_dir},dst=/qdrant/storage" \
    "$QDRANT_IMAGE" >/dev/null
  qdrant_ready=0
  for _ in $(seq 1 90); do
    if docker run --rm --network "$network" node:22.19-bookworm-slim \
      node -e "fetch('http://${qdrant}:6333/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      qdrant_ready=1
      break
    fi
    sleep 1
  done
  if [[ "$qdrant_ready" != 1 ]]; then
    docker logs "$qdrant" >&2
    exit 1
  fi

  generation="${RUN_ID}-${benchmark}-v1"
  collection="pimem_${benchmark}_v1"
  docker run -d --name "$server" --network "$network" \
    --user 0:0 \
    --log-opt max-size=100m --log-opt max-file=5 \
    -e PIMEM_EMBEDDING_BASE_URL -e PIMEM_EMBEDDING_API_KEY \
    -e PIMEM_EMBEDDING_MODEL -e PIMEM_EMBEDDING_DIMENSIONS \
    -e OPENAI_API_KEY \
    -e PIMEM_AUTH_SCHEME=none \
    -e PIMEM_AGENT_PROVIDER=pimem-openai -e PIMEM_AGENT_MODEL=gpt-4o-mini \
    -e PIMEM_AGENT_API_KEY_ENV=OPENAI_API_KEY \
    -e PIMEM_AGENT_BASE_URL="${OPENAI_API_BASE}" \
    -e PIMEM_AGENT_THINKING_LEVEL=off \
    -e PIMEM_DENSE_BACKEND=qdrant-hnsw \
    -e PIMEM_QDRANT_URL="http://${qdrant}:6333" \
    -e PIMEM_QDRANT_COLLECTION="$collection" \
    -e PIMEM_VECTOR_GENERATION_ID="$generation" \
    -e PIMEM_QDRANT_HNSW_M=32 -e PIMEM_QDRANT_EF_CONSTRUCT=200 \
    -e PIMEM_QDRANT_HNSW_EF=800 \
    -e PIMEM_QDRANT_INDEXING_THRESHOLD_KB=100 \
    -e PIMEM_QDRANT_FULL_SCAN_THRESHOLD_KB=100 \
    -e PIMEM_QDRANT_SYNC_BATCH_SIZE=512 -e PIMEM_QDRANT_SYNC_CONCURRENCY=8 \
    -e PIMEM_SQLITE_RETRIEVAL_WORKERS=128 \
    -e PIMEM_MAX_CONCURRENT_ADDS=1 \
    -e PIMEM_MAX_CONCURRENT_SEARCHES=128 \
    -e PIMEM_MAX_RUN_MS=600000 -e PIMEM_SEARCH_ATTEMPTS=1 \
    -e PIMEM_SEARCH_ARTIFACT_DIR=/agent-artifacts \
    --mount "type=bind,src=${sqlite_dir},dst=/data" \
    --mount "type=bind,src=${artifact_dir},dst=/agent-artifacts" \
    -p "127.0.0.1:${PORT}:8080" \
    "$IMAGE" >/dev/null

  api_ready=0
  for _ in $(seq 1 180); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      api_ready=1
      break
    fi
    sleep 1
  done
  if [[ "$api_ready" != 1 ]]; then
    docker logs "$server" >&2
    exit 1
  fi

  echo "[$(date -Is)] START benchmark=${benchmark} slots=128 storage=${benchmark_root}"
  python3 "$RUNNER" run "$benchmark" \
    --memmachine-root "$MEMMACHINE_ROOT" \
    --base-url "http://127.0.0.1:${PORT}" \
    --run-id "$RUN_ID" \
    --output-root "$OUTPUT_ROOT" \
    --top-k "$TOP_K" \
    --concurrency 128 \
    --attempts "$ATTEMPTS" \
    --timeout-seconds 620 \
    --max-records "$MAX_RECORDS" \
    --max-questions-per-record "$MAX_QUESTIONS"

  search_results="${benchmark_root}/search-results.jsonl"
  artifact_index="${benchmark_root}/agent-artifact-index.jsonl"
  test -s "$search_results"
  python3 "$INDEXER" "$search_results" "$artifact_dir" "$artifact_index" \
    >"${benchmark_root}/agent-artifact-summary.json"
  chmod 600 "$artifact_index" "${benchmark_root}/agent-artifact-summary.json" \
    "${benchmark_root}/search-results.jsonl" "${benchmark_root}/search-summary.json" \
    "${benchmark_root}/ingest-state.json"
  test -s "$artifact_index"
  echo "[$(date -Is)] DONE benchmark=${benchmark} searches=${search_results} agent=${artifact_index}"
  cleanup
done

python3 - "$run_root" <<'PY'
import json, os, sys
from pathlib import Path
root=Path(sys.argv[1])
benchmarks=[]
for summary_path in sorted(root.glob("scriptmem_*/search-summary.json")):
    search=json.loads(summary_path.read_text())
    agent=json.loads((summary_path.parent/"agent-artifact-summary.json").read_text())
    benchmarks.append({"benchmark":search["benchmark"],"search":search["status_counts"],"agent":agent})
manifest={"schema_version":"pimem-scriptmem-run/v1","run_id":root.name,"search_slots":128,"sqlite_workers":128,"benchmarks":benchmarks}
path=root/"run-summary.json"
path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
os.chmod(path,0o600)
PY

echo "[$(date -Is)] COMPLETE run_id=${RUN_ID} summary=${run_root}/run-summary.json"
