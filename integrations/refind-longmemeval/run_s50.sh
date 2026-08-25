#!/usr/bin/env bash
set -euo pipefail

: "${REFIND_ROOT:?Set REFIND_ROOT to the isolated experiment directory}"
: "${REFIND_EMBEDDING_ENV:?Set REFIND_EMBEDDING_ENV to a mode-0600 env file}"
: "${REFIND_MODEL_ENV:?Set REFIND_MODEL_ENV to a mode-0600 env file}"
: "${REFIND_EVALUATOR_SOURCE:?Set REFIND_EVALUATOR_SOURCE to the 500-question evaluator source}"
: "${PIMEM_SOURCE_COMMIT:?Set PIMEM_SOURCE_COMMIT to the runtime source commit}"
: "${PIMEM_SOURCE_FINGERPRINT:?Set PIMEM_SOURCE_FINGERPRINT to the runtime snapshot digest}"

REFIND_DATA_DIR="${REFIND_DATA_DIR:-${REFIND_ROOT}/data-s50}"
REFIND_OUTPUT_DIR="${REFIND_OUTPUT_DIR:-${REFIND_ROOT}/full-native}"
REFIND_SLOTS="${REFIND_SLOTS:-4}"
REFIND_HEALTH_RETRY_SECONDS="${REFIND_HEALTH_RETRY_SECONDS:-600}"
REFIND_EXPECTED_QUESTIONS="${REFIND_EXPECTED_QUESTIONS:-50}"
REFIND_RETRIEVAL_MODEL="${REFIND_RETRIEVAL_MODEL:-gpt-5-mini}"
REFIND_ANSWER_MODEL="${REFIND_ANSWER_MODEL:-gpt-5-mini}"
REFIND_JUDGE_MODEL="${REFIND_JUDGE_MODEL:-gpt-4.1-mini}"
REFIND_RETRIEVAL_THINKING_LEVEL="${REFIND_RETRIEVAL_THINKING_LEVEL:-medium}"
REFIND_ANSWER_THINKING_LEVEL="${REFIND_ANSWER_THINKING_LEVEL:-medium}"
REFIND_NODE_BIN="${REFIND_NODE_BIN:-node}"
REFIND_RUN_LABEL="${REFIND_RUN_LABEL:-$(basename "${REFIND_OUTPUT_DIR}")}"
REFIND_RUN_LOG="${REFIND_ROOT}/logs/${REFIND_RUN_LABEL}.log"
REFIND_JUDGE_LOG="${REFIND_ROOT}/logs/${REFIND_RUN_LABEL}-judge.log"

mkdir -p "${REFIND_ROOT}/logs" "${REFIND_OUTPUT_DIR}"
chmod 700 "${REFIND_ROOT}/logs" "${REFIND_OUTPUT_DIR}"

set -a
# shellcheck disable=SC1090
source "${REFIND_EMBEDDING_ENV}"
# shellcheck disable=SC1090
source "${REFIND_MODEL_ENV}"
set +a

export PIMEM_SOURCE_DIRTY=true

question_count=$(wc -l < "${REFIND_DATA_DIR}/private/questions.jsonl")
if [[ "${question_count}" -ne "${REFIND_EXPECTED_QUESTIONS}" ]]; then
  echo "Expected ${REFIND_EXPECTED_QUESTIONS} private questions, found ${question_count}" >&2
  exit 1
fi
if ! grep -q '"missing": 0' "${REFIND_ROOT}/logs/full-index.log"; then
  echo "Embedding index completeness gate failed" >&2
  exit 1
fi

count_records() {
  find "${REFIND_OUTPUT_DIR}/records" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l
}

has_terminal_method_failure() {
  python3 - "${REFIND_OUTPUT_DIR}/failure-records" <<'PY'
import json
import pathlib
import re
import sys

infrastructure = re.compile(
    r"(?:HTTP\s+(?:408|425|429|5\d\d)|status code\s+(?:408|425|429|5\d\d)|"
    r"API error\s*\((?:401|403|408|425|429|5\d\d)\)|rate limit|"
    r"fetch failed|ECONN|ETIMEDOUT|invalid_encrypted_content)",
    re.IGNORECASE,
)
failure_dir = pathlib.Path(sys.argv[1])
for path in failure_dir.glob("*.json"):
    error = json.loads(path.read_text(encoding="utf-8")).get("error", "")
    if isinstance(error, str) and not infrastructure.search(error):
        raise SystemExit(0)
raise SystemExit(1)
PY
}

wait_for_reasoning_chat_model() {
  local model="$1"
  local response_path="${REFIND_ROOT}/logs/${model}-health-response.json"
  local status
  while true; do
    status=$(curl -sS -o "${response_path}" -w '%{http_code}' \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" \
      -H 'Content-Type: application/json' \
      --data "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply only OK.\"}],\"max_completion_tokens\":4096,\"reasoning_effort\":\"${REFIND_RETRIEVAL_THINKING_LEVEL}\"}" \
      "${OPENAI_API_BASE%/}/chat/completions" || true)
    printf '%s %s status=%s\n' "$(date -Is)" "${model}" "${status}" \
      >> "${REFIND_ROOT}/logs/provider-health.log"
    [[ "${status}" == 200 ]] && return
    sleep "${REFIND_HEALTH_RETRY_SECONDS}"
  done
}

wait_for_judge_model() {
  local response_path="${REFIND_ROOT}/logs/${REFIND_JUDGE_MODEL}-health-response.json"
  local status
  while true; do
    status=$(curl -sS -o "${response_path}" -w '%{http_code}' \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" \
      -H 'Content-Type: application/json' \
      --data "{\"model\":\"${REFIND_JUDGE_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply only OK.\"}],\"temperature\":0,\"top_p\":0.9,\"max_tokens\":256}" \
      "${OPENAI_API_BASE%/}/chat/completions" || true)
    printf '%s %s status=%s\n' "$(date -Is)" "${REFIND_JUDGE_MODEL}" "${status}" \
      >> "${REFIND_ROOT}/logs/provider-health.log"
    [[ "${status}" == 200 ]] && return
    sleep "${REFIND_HEALTH_RETRY_SECONDS}"
  done
}

cd "${REFIND_ROOT}/runtime-source"
while [[ "$(count_records)" -lt "${REFIND_EXPECTED_QUESTIONS}" ]]; do
  wait_for_reasoning_chat_model "${REFIND_RETRIEVAL_MODEL}"
  "${REFIND_NODE_BIN}" dist/cli.js benchmark-longmemeval \
    --data-dir "${REFIND_DATA_DIR}" \
    --output-dir "${REFIND_OUTPUT_DIR}" \
    --retrieval-profile pimem-hybrid \
    --skill pimem-v0 \
    --slots "${REFIND_SLOTS}" \
    --max-search-calls 4 \
    --retrieval-model-adapter openai-reasoning-completions \
    --retrieval-provider refind-openai \
    --retrieval-model "${REFIND_RETRIEVAL_MODEL}" \
    --retrieval-thinking-level "${REFIND_RETRIEVAL_THINKING_LEVEL}" \
    --retrieval-api-key-env OPENAI_API_KEY \
    --retrieval-base-url-env OPENAI_API_BASE \
    --retrieval-transport non-stream \
    --retrieval-context-window 128000 \
    --retrieval-max-tokens 4096 \
    --answer-model-adapter openai-reasoning-completions \
    --answer-provider refind-openai \
    --answer-model "${REFIND_ANSWER_MODEL}" \
    --answer-thinking-level "${REFIND_ANSWER_THINKING_LEVEL}" \
    --answer-api-key-env OPENAI_API_KEY \
    --answer-base-url-env OPENAI_API_BASE \
    --answer-transport non-stream \
    --answer-context-window 128000 \
    --answer-max-tokens 4096 \
    >> "${REFIND_RUN_LOG}" 2>&1 || true
  if has_terminal_method_failure; then
    echo "Terminal PiMem method failure detected; refusing retry-until-success." \
      >> "${REFIND_RUN_LOG}"
    echo "Materialize the fixed denominator with materialize_scored_predictions.py." \
      >> "${REFIND_RUN_LOG}"
    exit 2
  fi
  sleep 60
done

"${REFIND_NODE_BIN}" dist/cli.js prepare-longmemeval-eval \
  --source "${REFIND_EVALUATOR_SOURCE}" \
  --predictions "${REFIND_OUTPUT_DIR}/predictions.jsonl" \
  --output "${REFIND_OUTPUT_DIR}/evaluation/refind-longmemeval-eval.json" \
  >> "${REFIND_RUN_LOG}" 2>&1

wait_for_judge_model
export JUDGER_API_KEY="${OPENAI_API_KEY}"
export JUDGER_API_BASE="${OPENAI_API_BASE}"
export JUDGER_MODEL="${REFIND_JUDGE_MODEL}"
python3 scripts/longmemeval_frozen_eval.py judge \
  --input "${REFIND_OUTPUT_DIR}/evaluation/refind-longmemeval-eval.json" \
  --output-dir "${REFIND_OUTPUT_DIR}/evaluation/refind-judge" \
  --slots "${REFIND_SLOTS}" \
  --variant "pimem-native-refind-s50-${REFIND_RUN_LABEL}" \
  --protocol refind-2026 \
  >> "${REFIND_JUDGE_LOG}" 2>&1
