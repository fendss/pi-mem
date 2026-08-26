# PiMem × MemoryAgentBench

This is a standalone, black-box MemoryAgentBench adapter. It supports ten PiMem
targets:

| Task ID | Official source | Capability | Official metric |
|---|---|---|---|
| `ruler-qa1` | `ruler_qa1_197K` | accurate retrieval | `substring_exact_match` |
| `longmemeval-s` | `longmemeval_s*` | accurate retrieval | GPT-4o LLM judge |
| `trec-coarse` | `icl_trec_coarse_6600shot_balance` | test-time learning | `exact_match` |
| `trec-fine` | `icl_trec_fine_6400shot_balance` | test-time learning | `exact_match` |
| `banking77` | `icl_banking77_5900shot_balance` | test-time learning | `exact_match` |
| `nlu` | `icl_nlu_8296shot_balance` | test-time learning | `exact_match` |
| `clinic150` | `icl_clinic150_7050shot_balance` | test-time learning | `exact_match` |
| `fact-sh-6k` | `factconsolidation_sh_6k` | conflict resolution | `substring_exact_match` |
| `fact-mh-6k` | `factconsolidation_mh_6k` | conflict resolution | `substring_exact_match` |
| `eventqa-64k` | `eventqa_65536` | accurate retrieval | `substring_exact_match` |

## Boundary

The adapter does not import `src/`, `dist/`, PiMem packages, or the upstream
MemoryAgentBench checkout. PiMem is a separately started service and is reached
only through this HTTP lifecycle:

1. `POST /memory/initialize`
2. `POST /memory/add` for every ordered context chunk
3. `POST /memory/wrap_user_prompt` for every query

The wrapped prompt is sent to a separately configured OpenAI-compatible
`/chat/completions` endpoint. Ground-truth answers remain inside the adapter and
are used only after the model has returned its prediction.

Dataset files and outputs are ignored locally and are never committed. Official
code and dataset revisions, file sizes, and SHA-256 values are fixed in
`pins.json`. The upstream benchmark checkout is neither patched nor vendored.

Dependency direction:

```text
MemoryAgentBench data -> standalone adapter -> PiMem HTTP API
                                      `-----> answer-model HTTP API

PiMem core ---------------------------------> (no benchmark dependency)
```

## Setup

Run these commands from this directory. Python 3.10 or newer is supported.

### Linux/macOS

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m nltk.downloader punkt_tab
```

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m nltk.downloader punkt_tab
```

## Prepare and validate data

```bash
python run.py list
python run.py download --data-dir data
python run.py validate --data-dir data
```

The download is resolved from the pinned Hugging Face revision rather than
`main`. Validation fails closed on a changed hash, size, schema, source name,
context count, or question count.

## Start PiMem

Build and start PiMem from the repository root in another terminal. This uses
the already existing memory HTTP entrypoint; the adapter does not change it.

```bash
npm run build
PORT=3111 npm run serve:memoryarena-public
```

Configure PiMem's model and embedding provider using the environment variables
documented by the existing MemoryArena entrypoint. Wait for its `listening`
event before starting a benchmark run.

## Smoke run

Set the API key for the answer endpoint, then execute one query:

```bash
export OPENAI_API_KEY=...
python run.py run \
  --task fact-sh-6k \
  --data-dir data \
  --output outputs/fact-sh-6k-smoke.json \
  --memory-base-url http://127.0.0.1:3111 \
  --answer-base-url https://api.openai.com/v1 \
  --answer-model gpt-4.1-mini \
  --max-contexts 1 \
  --max-queries 1
```

For a local OpenAI-compatible endpoint that does not require authentication,
the key may be omitted; the adapter then sends no `Authorization` header.

Remove the two limits for a full task run. Add `--resume` to preserve completed
predictions and continue after infrastructure failure. A resumed context is
reinitialized and re-ingested before pending queries are issued. Resume fails
closed if the benchmark/data pins, task templates, memory endpoint/backend, or
answer endpoint/model differ from the saved run.

The same command works for every task listed by `python run.py list` by changing
`--task` and the output filename.

## Results and evaluation

Every output records the immutable upstream revisions, task identity, model,
per-query prediction, private reference, local metrics, and aggregate metrics.
The `score` command recomputes deterministic metrics without contacting either
service:

```bash
python run.py score --input outputs/fact-sh-6k.json
```

For LongMemEval-S, `official_score` intentionally remains `null`: its official
metric is the upstream GPT-4o judge, not a locally invented substitute. The
output's `data` array contains the upstream-required `output` and `answer`
fields in official dataset order and can be staged for
`llm_based_eval/longmem_qa_evaluate.py` from the pinned benchmark commit.

## Tests

```bash
python -B -m unittest discover -s tests -p 'test_*.py'
```

The tests are offline. They include a complete mock PiMem → wrapped prompt →
answer-model run and an isolation check that rejects imports from PiMem project
code.
