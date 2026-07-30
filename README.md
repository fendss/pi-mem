# PiMem

PiMem is a minimal memory-agent runtime built on `pi-agent-core`.

Its contract is deliberately small:

```text
immutable raw memory
        ↓
search / read / bash_ro
        ↓
Pi Agent retrieves and organizes evidence
        ↓
finish(sufficient | insufficient, citations)
        ↓
caller-owned benchmark answer adapter
```

PiMem stops at the cited evidence package. It does not own answer formatting or a universal answer prompt. Each benchmark adapter supplies its own answer protocol after retrieval. Ingest never invokes a generative model.

## Version 1.0

- deterministic TypeScript ingest and an immutable SQLite source store;
- SQLite FTS5 plus optional `text-embedding-v4` dense retrieval, candidate-local BM25, and RRF;
- Agent-routed `hybrid`, `lexical`, `coverage`, `temporal`, `numeric`, and `history` search operators behind a three-field API;
- harness-owned scope enforcement, prepared SQL, session aggregation, fact joins, ranking, and provenance;
- resumable Float32 derived embeddings that never modify raw memory;
- exact `read` with neighboring source turns;
- networkless, read-only Docker shell over one sanitized scope;
- Pi Core retrieval-agent loop with internally consistent evidence summaries, citation supports, counts, and inventories;
- structured `sufficient` / `insufficient` evidence selection;
- benchmark-owned answer adapters, including LongMemEval-S;
- automatic candidate, evidence, citation and tool-trace export;
- trusted LongMemEval-S adapter with memory/private/gold separation.

The runtime enforces:

```text
Citations ⊆ Evidence ⊆ Candidates
```

Search previews and shell output are candidates only. A memory must be
successfully read in the current run before `finish` may cite it.

## Leakage boundary

The LongMemEval adapter constructs memory from this whitelist only:

```text
conversation.speaker_a
conversation.speaker_b
conversation.session_N_date_time
conversation.session_N[].dia_id
conversation.session_N[].speaker
conversation.session_N[].text
```

Question text and raw question ID are written to `private/questions.jsonl`,
which is used by the runner but is never mounted into `bash_ro`. Answers,
evidence labels, categories, answer-session IDs and benchmark metadata are
never copied into PiMem data.

## Ingest and search flow

Raw ingest always runs before derived indexing:

```text
LongMemEval adapter whitelist
  -> sanitized source turns
  -> immutable memories rows + FTS5 rows
  -> scope-only read-only export
  -> optional missing embedding rows for pimem-hybrid
```

A raw scope that already exists byte-for-byte reports `status: unchanged`; this
means ingest was verified as a no-op, not skipped. `pimem-hybrid` then checks its
own derived index independently and writes only missing vectors. Ingest never
calls the Pi answer model or any generative model.

The runner selects one internal search profile before creating the Agent:

```text
fts5:
  query -> scope/session/time filters -> SQLite FTS5 -> candidates

pimem-hybrid:
  query embedding -> scope-filtered dense candidates
  + SQLite FTS5 candidates
  -> candidate-local BM25Okapi over the union
  -> RRF(dense, FTS5, BM25, k=60) -> candidates
```

The Agent routes one `search` call with only `operator`, `queries`, and optional
`limit`. Operators are `hybrid`, `lexical`, `coverage`, `temporal`, `numeric`,
and `history`. Their SQL, per-query coverage, session aggregation, fact joins,
and provenance stay inside the harness; no question-keyword routing or
model-authored SQL is used. The Agent still sees only `search`, `read`,
`bash_ro`, and `finish`. Search results become candidates, `read` promotes exact
raw records to evidence, and only read evidence may be cited by `finish`.

## Leaderboard Add / Search API

The production wrapper implements the synchronous Agent Memory Leaderboard
contract:

```text
GET  /health
POST /v1/memories/add
POST /v1/memories/search
```

`user_id` is hashed into the only retrieval scope. Add requests are immutable
and idempotent by `request_id`; HTTP 200 is returned only after SQLite, FTS5,
embeddings, and deterministic fact sidecars are searchable. Search runs the
normal PiMem Agent and returns at most `top_k` items in this order:

```text
deterministic source-grounded evidence capsule
cited immutable raw memories
other read evidence
remaining candidates
```

The capsule is a JSON string in the first result's `content`. It preserves
`status`, `evidence_summary`, citation supports, count, inventory, and source
IDs. It contains no final answer or model instructions, and every cited claim
is followed by its raw source memory. The capsule ID is a deterministic hash of
the scope, query, and canonical package.

Build and run the container:

```bash
docker build -t pimem:1.0.0 .
chmod 600 /path/to/pimem-leaderboard.env

docker run --rm --name pimem \
  --env-file /path/to/pimem-leaderboard.env \
  -v pimem-data:/data \
  -p 8080:8080 \
  pimem:1.0.0
```

The protected environment file must provide:

```text
PIMEM_AUTH_SCHEME=x-api-key
PIMEM_MEMORY_API_KEY=<leaderboard-facing secret>
PIMEM_AGENT_PROVIDER=pimem-openai
PIMEM_AGENT_MODEL=gpt-4o-mini
PIMEM_AGENT_BASE_URL=<OpenAI-compatible base URL>
PIMEM_AGENT_API_KEY=<retrieval Agent provider secret>
PIMEM_EMBEDDING_BASE_URL=<OpenAI-compatible embedding base URL>
PIMEM_EMBEDDING_API_KEY=<embedding provider secret>
PIMEM_EMBEDDING_MODEL=text-embedding-v4
PIMEM_EMBEDDING_DIMENSIONS=1024
```

The wrapper constructs the requested OpenAI-compatible Agent runtime directly
from these environment variables; no provider configuration or secret is baked
into the image. Optional capacity controls are
`PIMEM_MAX_CONCURRENT_ADDS` (default 1), `PIMEM_MAX_CONCURRENT_SEARCHES`
(default 4), and `PIMEM_MAX_RUN_MS` (default 120000). Terminate HTTPS in a
public reverse proxy, keep `/health` unauthenticated, and delete evaluation data
from the persistent volume within the leaderboard retention window.

Contract examples:

```bash
curl -X POST https://memory.example.com/v1/memories/add \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: ...' \
  -d '{"request_id":"req-1","messages":[{"role":"user","content":"memory text","timestamp":1704067200000}],"user_id":"eval:user-1","session_id":"session-1"}'

curl -X POST https://memory.example.com/v1/memories/search \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: ...' \
  -d '{"query":"What should be remembered?","user_id":"eval:user-1","top_k":100}'
```

### Local retrieval-only benchmark exports

`scripts/leaderboard_local_search_eval.py` reads the benchmark registry from a
MemMachine checkout, sends only conversations to Add and only questions/options
to Search, and writes the exact ordered Search products as JSONL. It never runs
an Answer model, Judge, or scorer, and its artifacts exclude gold answers,
rubrics, supporting facts, existing answers, and evaluation labels.

`scripts/run_leaderboard_local_search_suite.sh` runs all 14 registered sources
sequentially. Every benchmark receives a distinct Docker volume containing its
own `/data/memory.sqlite`; records inside that database remain isolated by
`user_id`. The runner is idempotent and resumes completed ingest records and
Search rows.

```bash
# One-record, one-question smoke with a physically isolated database.
PIMEM_LOCAL_EVAL_BENCHMARKS=clbench_locomo_0_4k \
PIMEM_LOCAL_EVAL_MAX_RECORDS=1 \
PIMEM_LOCAL_EVAL_MAX_QUESTIONS_PER_RECORD=1 \
PIMEM_LOCAL_EVAL_SEARCH_CONCURRENCY=1 \
./scripts/run_leaderboard_local_search_suite.sh smoke-v1

# Full registered suite. This is large: about 19.8k questions and 1.92m messages.
./scripts/run_leaderboard_local_search_suite.sh full-v1
```

The only handoff required downstream is:

```text
/home/zhaogangyi/pi-mem-local-eval/<run-id>/<benchmark>/search-results.jsonl
```

Each row contains question identity, the exact query/options sent to Search,
latency/status, and the returned `data` array (evidence capsule followed by raw
memories). `database.json` records the benchmark-specific volume, while
`search-summary.json` reports only completion/error counts.

## Commands

Node 22.19 or newer is required. The full benchmark suite also requires
Python 3 and the packages in `requirements-dev.txt`.

```bash
npm install
python3 -m pip install -r requirements-dev.txt
npm run build

npm run cli -- ingest-longmemeval \
  --source /path/to/longmemeval_s_cleaned_converted.json \
  --data-dir ./data \
  --question-id e47becba

npm run cli -- run-longmemeval \
  --data-dir ./data \
  --question-id e47becba

npm run cli -- benchmark-longmemeval \
  --data-dir ./data \
  --output-dir ./runs/canary \
  --retrieval-profile pimem-hybrid \
  --model gpt-4o-mini \
  --slots 16

# One resumable command owns retry waves, progress, audit, packaging and Judger v5.
npm run cli -- longmemeval-suite \
  --source /path/to/longmemeval_s_cleaned_converted.json \
  --data-dir ./data \
  --output-dir ./runs/full-suite \
  --retrieval-profile pimem-hybrid \
  --embedding-env "$HOME/.config/pi-mem/embedding.env" \
  --answer-env "$HOME/.config/pi-mem/answer.env" \
  --judge-env "$HOME/.config/pi-mem/judger.env" \
  --agent-dir "$HOME/.pi/agent" \
  --provider pimem-openai \
  --model gpt-4o-mini \
  --slots 16 \
  --frozen-slots 16 \
  --judge-slots 16 \
  --archive ./runs/full-suite.tar.gz \
  --evaluation-archive ./runs/full-suite-evaluation.tar.gz

npm run cli -- prepare-longmemeval-eval \
  --source /path/to/longmemeval_s_cleaned_converted.json \
  --predictions ./runs/canary/predictions.jsonl \
  --output ./runs/canary/longmemeval-eval.json

npm run cli -- package-benchmark \
  --output-dir ./runs/canary \
  --archive ./runs/canary.tar.gz
```

Repeat `--question-id` to ingest more than one scope. Omitting it ingests the
full LongMemEval-S split.

All ingest/run commands default to `--retrieval-profile fts5`. To build and use
the PiMem hybrid profile, set the embedding environment without putting
secrets on the command line, then pass `--retrieval-profile
pimem-hybrid` to both ingest and run. Full indexing can additionally use
`--embedding-slots 8 --embedding-rps 6` for globally bounded asynchronous
requests:

```text
PIMEM_EMBEDDING_BASE_URL
PIMEM_EMBEDDING_API_KEY
PIMEM_EMBEDDING_MODEL=text-embedding-v4
PIMEM_EMBEDDING_DIMENSIONS=1024
PIMEM_EMBEDDING_MAX_INPUT_LENGTH=2048
PIMEM_EMBEDDING_BATCH_SIZE=10
```

`--embedding-slots` controls in-flight embedding requests and
`--embedding-rps` controls their global start rate. All slots share one gate;
each slot remains sequential, SQLite writes stay in short synchronous
transactions, and existing vectors are skipped on resume. The conservative
`8/6` profile matches the audited provider capacity plan while retaining the
endpoint-safe 10-input request batch. HTTP errors, network failures, timeouts,
and malformed or incomplete responses retry indefinitely at 1, 2, 4, 8, 16,
then 30 seconds. Every retry re-enters the global request gate; only explicit
abort or invalid startup configuration terminates the loop.

The hybrid profile embeds `{role}: {exact original content}`, retrieves dense
`top max(20, 4 * limit)` after applying scope/session/time filters, and reranks
only those candidates with identity order plus BM25Okapi through `RRF(k=60)`.
The endpoint, key, Authorization header, vectors, and full API response are not
written to runner output. A missing key, failed query embedding, or incomplete
scope index is an error; hybrid never silently falls back to FTS5.

`longmemeval-suite` loads only mode-`0600`, runner-owned protected environment files. It passes API keys by environment-variable name and overrides the configured provider base URL from `OPENAI_API_BASE`, so rotating `answer.env` does not require rewriting `models.json`. It fails fast on `401`, `403`, or invalid-token errors, while `429`, timeout, transport, and transient upstream failures remain durably resumable. The command owns progress, retry waves, completeness/provenance audit, benchmark packaging, evaluator preparation, Judger v5, a gold-isolated frozen re-answer over the current run's exact `searchedMemories`, paired comparison, and evaluation packaging.

The batch command accepts `--slots 1..256`. Each asynchronous slot runs one
fresh Agent at a time and takes the next unanswered question immediately after
its current per-question record is durable. A four-question canary wave runs
before a larger pool, and a systemic API failure opens a circuit breaker before
more questions are scheduled. Slots share one immutable database but use
independent retrieval wrappers so per-question embedding and rerank metrics do
not overlap.

Each success contains separate retrieval and benchmark-answer stages and is first written atomically under `records/`, making interruption and resume independent of concurrent JSONL appends. At batch settlement, PiMem
materializes:

- `predictions.jsonl`: compact evaluator-facing answers;
- `traces.jsonl`: complete PiMem retrieval traces plus benchmark answer metadata;
- `results.json`: one JSON document containing every durable two-stage record;
- `failures.jsonl`: unresolved per-question failures, empty after full success;
- `run-manifest.json`: question-set hash, model, retrieval profile, slot count,
  and system-prompt hash, with no endpoint or credential.

Every result includes exact `searchedMemories`, selected read evidence, citations, candidate provenance, retrieval-agent metadata, benchmark answer prompt identity/hash, answer-model metadata, retrieval metadata, and metrics. The retrieval skill never contains LongMemEval answer formatting rules. `package-benchmark` refuses incomplete or failed runs and creates a
`0600` tar.gz containing the consolidated artifacts plus SHA-256 checksums.
Runner outputs may contain raw question IDs and memory contents, but they are
never mounted into another Agent's memory scope.

`prepare-longmemeval-eval` is a separate evaluator-side step. Only after all
Agent runs are finished does it read gold answers/types and create the array
accepted by LongMemEval's `longmemeval_evaluate.py`.

Run commands read Pi model configuration from `~/.pi/agent` by default.
`--agent-dir`, `--provider`, `--model`, and `--thinking-level` can select another
preconfigured model without mutating global settings. Provider credentials must
remain trusted `!command` entries (for example, a command that reads a
process-only environment variable); CLI flags never accept or print API keys.

## Frozen selection replay

Use a frozen selection replay to measure answer-adapter reproducibility without
rerunning the stochastic retrieval Agent. The prepared input contains no gold
or original benchmark answer fields. `--include-selection-data` exports only
the Agent-selected citations, evidence, summary, count, and inventory; it does
not claim that experimental evidence packages exist.

```bash
python3 scripts/longmemeval_frozen_eval.py prepare-frozen-input \
  --results /path/to/run/results.json \
  --output /path/to/replay/input.json \
  --include-selection-data

# Load the protected answer environment before this command.
python3 scripts/longmemeval_frozen_eval.py reanswer \
  --input /path/to/replay/input.json \
  --output-dir /path/to/replay \
  --slots 32 \
  --mode selection-aware-v3
```

The replay manifest fixes the input hash, prompt hash, requested model, slot
count, and gold-visibility boundary. Existing durable per-question records are
resumed only when the configuration and search-result hashes still match.
## `bash_ro`

The shell is not the host shell. Each call starts a disposable container with:

- only the selected sanitized scope mounted at `/memory`, read-only;
- networking disabled;
- all Linux capabilities dropped;
- `no-new-privileges`;
- read-only root filesystem;
- CPU, memory, process, time and output limits.

Its purpose is source navigation (`grep`, `sed`, `awk`, `find`, small Python
scripts), especially when fixed retrieval misses a useful lexical or temporal
pattern.

## Development checks

```bash
npm run typecheck
npm test
npm run build
python3 -m unittest scripts/test_longmemeval_frozen_eval.py
```
