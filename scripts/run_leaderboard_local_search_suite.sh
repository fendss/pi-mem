#!/usr/bin/env bash
# Run MemMachine's registered benchmark corpus through PiMem Add/Search only.
# Every benchmark gets a physically separate Docker volume / SQLite database.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/leaderboard_local_search_eval.py"
RUN_ID="${1:-pimem-local-$(date -u +%Y%m%dT%H%M%SZ)}"
MEMMACHINE_ROOT="${MEMMACHINE_ROOT:-/home/zhaogangyi/MemMachine}"
OUTPUT_ROOT="${PIMEM_LOCAL_EVAL_OUTPUT_ROOT:-/home/zhaogangyi/pi-mem-local-eval}"
IMAGE="${PIMEM_LOCAL_EVAL_IMAGE:-pimem-leaderboard:6baf6c4}"
PORT="${PIMEM_LOCAL_EVAL_PORT:-19088}"
SEARCH_CONCURRENCY="${PIMEM_LOCAL_EVAL_SEARCH_CONCURRENCY:-4}"
TOP_K="${PIMEM_LOCAL_EVAL_TOP_K:-100}"
ATTEMPTS="${PIMEM_LOCAL_EVAL_ATTEMPTS:-3}"
INTERNAL_SEARCH_ATTEMPTS="${PIMEM_LOCAL_EVAL_INTERNAL_SEARCH_ATTEMPTS:-1}"
MAX_RECORDS="${PIMEM_LOCAL_EVAL_MAX_RECORDS:-0}"
MAX_QUESTIONS="${PIMEM_LOCAL_EVAL_MAX_QUESTIONS_PER_RECORD:-0}"

DEFAULT_BENCHMARKS=(
  locomo_refined
  longmemeval_refined
  longmemeval_s_cleaned
  clbench_locomo_0_4k
  clbench_locomo_16_32k
  personamem_v1_32k
  personamem_v1_128k
  personamem_v1_1m
  personamem_v2_32k
  personamem_v2_128k
  scriptmem_angry
  scriptmem_enemy
  scriptmem_man_earth
  scriptmem_friends
)
if [[ -n "${PIMEM_LOCAL_EVAL_BENCHMARKS:-}" ]]; then
  IFS=',' read -r -a BENCHMARKS <<<"${PIMEM_LOCAL_EVAL_BENCHMARKS}"
else
  BENCHMARKS=("${DEFAULT_BENCHMARKS[@]}")
fi

umask 077
mkdir -p "${OUTPUT_ROOT}/${RUN_ID}"
chmod 700 "${OUTPUT_ROOT}" "${OUTPUT_ROOT}/${RUN_ID}"
set -a
. /home/zhaogangyi/.config/pi-mem/embedding.env
. /home/zhaogangyi/.config/pi-mem/answer.env
set +a

container="pimem-local-eval"
cleanup_container() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup_container EXIT

for benchmark in "${BENCHMARKS[@]}"; do
  benchmark_slug="$(printf '%s' "${benchmark}" | tr -c 'a-zA-Z0-9_.-' '-')"
  run_slug="$(printf '%s' "${RUN_ID}" | tr -c 'a-zA-Z0-9_.-' '-' | cut -c1-40)"
  volume="pimem-eval-${run_slug}-${benchmark_slug}"
  output_dir="${OUTPUT_ROOT}/${RUN_ID}/${benchmark}"
  mkdir -p "${output_dir}"
  chmod 700 "${output_dir}"
  docker volume create \
    --label pimem.eval.run="${RUN_ID}" \
    --label pimem.eval.benchmark="${benchmark}" \
    "${volume}" >/dev/null
  printf '{"schema_version":"pimem-local-database/v1","benchmark":"%s","run_id":"%s","docker_volume":"%s","database":"/data/memory.sqlite"}\n' \
    "${benchmark}" "${RUN_ID}" "${volume}" >"${output_dir}/database.json"
  chmod 600 "${output_dir}/database.json"

  cleanup_container
  docker run -d --name "${container}" \
    --log-opt max-size=10m --log-opt max-file=3 \
    -e PIMEM_EMBEDDING_BASE_URL -e PIMEM_EMBEDDING_API_KEY \
    -e PIMEM_EMBEDDING_MODEL -e PIMEM_EMBEDDING_DIMENSIONS \
    -e OPENAI_API_KEY \
    -e PIMEM_AUTH_SCHEME=none \
    -e PIMEM_AGENT_PROVIDER=pimem-openai -e PIMEM_AGENT_MODEL=gpt-4o-mini \
    -e PIMEM_AGENT_API_KEY_ENV=OPENAI_API_KEY \
    -e PIMEM_AGENT_BASE_URL="${OPENAI_API_BASE}" \
    -e PIMEM_MAX_CONCURRENT_ADDS=1 \
    -e PIMEM_MAX_CONCURRENT_SEARCHES="${SEARCH_CONCURRENCY}" \
    -e PIMEM_MAX_RUN_MS=600000 -e PIMEM_SEARCH_ATTEMPTS="${INTERNAL_SEARCH_ATTEMPTS}" \
    -v "${volume}:/data" \
    -p "127.0.0.1:${PORT}:8080" \
    "${IMAGE}" >/dev/null

  ready=0
  for _ in $(seq 1 45); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "${ready}" != 1 ]]; then
    docker logs "${container}" >&2
    exit 1
  fi

  echo "[$(date -Is)] START benchmark=${benchmark} database=${volume}"
  python3 "${RUNNER}" run "${benchmark}" \
    --memmachine-root "${MEMMACHINE_ROOT}" \
    --base-url "http://127.0.0.1:${PORT}" \
    --run-id "${RUN_ID}" \
    --output-root "${OUTPUT_ROOT}" \
    --top-k "${TOP_K}" \
    --concurrency "${SEARCH_CONCURRENCY}" \
    --attempts "${ATTEMPTS}" \
    --max-records "${MAX_RECORDS}" \
    --max-questions-per-record "${MAX_QUESTIONS}"
  test -s "${output_dir}/search-results.jsonl"
  test -s "${output_dir}/search-summary.json"
  echo "[$(date -Is)] DONE benchmark=${benchmark} artifact=${output_dir}/search-results.jsonl"
  cleanup_container
done

echo "[$(date -Is)] COMPLETE run_id=${RUN_ID} output=${OUTPUT_ROOT}/${RUN_ID}"
