# LongMemEval retrieval oracle ablation

This directory contains post-hoc research utilities. It is intentionally
outside PiMem's production retrieval and benchmark adapter paths.

`oracle_retrieval_ablation.mjs` asks a narrow architectural question: for
historical LongMemEval-S queries where the trace did not expose every mapped
gold source, which retrieval mechanism could have recovered the missing
source?

It reuses the exact historical questions, Agent-generated query strings,
memory scope, immutable SQLite records, embeddings, and post-hoc gold-memory
mapping. It does not run the Agent, answer model, or judge, and it does not
regenerate queries from the reference answer.

## Required inputs

1. The JSON emitted by `diagnose_longmemeval_pipeline.py`.
2. The original MemoryAgentBench run artifact JSON.
3. The service audit JSONL for that run.
4. The corresponding PiMem SQLite database, including its document embedding
   index.

Run `npm run build` first. Configure the same `PIMEM_EMBEDDING_*` profile that
created the stored document embeddings; query and anchor embeddings are fetched
once and cached in memory. The script creates a consistent temporary SQLite
backup before opening `MemoryStore`, so the supplied run database is read-only.

```bash
node integrations/memoryagentbench/research/oracle_retrieval_ablation.mjs \
  --diagnostic /path/pipeline-diagnostic.json \
  --artifact /path/longmemeval-s-static.json \
  --audit /path/service-audit.jsonl \
  --sqlite /path/pimem.sqlite \
  --output /path/oracle-retrieval-ablation.json
```

By default, the target is every `no_gold_candidate` or
`partial_gold_candidates` row. `--question-ids` accepts a comma-separated list,
a JSON array file, or one ID per line.

## Arms and interpretation

- `observed_search`: exact candidates exposed by search/search_more results.
- `observed_retrieval`: every candidate recorded anywhere in the retrieval
  trace, including read expansion. This exactly matches the candidate boundary
  used by `diagnose_longmemeval_pipeline.py`; anchor-driven arms deliberately
  continue to use `observed_search` only.
- `{hybrid,lexical}_depth_K`: replay all historical semantic calls at deeper
  top-k windows. These are the pagination/depth arms.
- `*_split_union*` and `*_split_rrf*`: execute every historical query string
  independently, then union or RRF them. The union arm is intentionally not
  budget matched; its candidate cost is reported. RRF is always reported at
  fixed top-20 and top-40, independent of the historical number of search
  calls.
- Split-query union/RRF is evaluated from both per-query top-20 and the maximum
  configured depth (top-100 by default). This distinguishes fusion suppression
  from a query path that never retrieved the gold source at all.
- `hybrid_session_breadth_*`: apply deterministic per-session admission while
  preserving the historical query strings.
- `observed_anchor_*_neighbor_*`: expand fixed, first-exposed candidates to
  adjacent turns in the same session.
- `observed_anchor_secondary_*`: use the contents of fixed, first-exposed
  candidates as the queries for one second corpus retrieval. This is the only
  non-oracle arm that directly tests candidate-dependent retrieval state.
- `oracle_rerank_*`: use gold IDs to place one available representative per
  gold group first. These arms are explicitly marked
  `uses_gold_during_retrieval: true` and are diagnostic upper bounds only.

Rows whose Agent-generated queries already contain an ISO-like date also have
separate `counterfactual_arms.metadata_date_window_*` results. These route only
that existing query date into record timestamp bounds and preserve the existing
queries and role filters. They are labelled counterfactual, are excluded from
the normal recovery classification and composed union, and do not add a
benchmark- or gold-derived query term.

The per-question `recovery_class` is deliberately conservative:

- `corpus_first_recoverable`: a deeper, alternative, fused, or session-diverse
  replay of the original query strings suffices.
- `candidate_dependent_only`: no tested corpus-first replay suffices, but
  neighbor or anchor-driven retrieval does. This is the evidence that would
  justify CandidateSet dataflow in PiMem.
- `not_recovered`: even the union of all tested non-oracle mechanisms misses at
  least one gold group; the result does not support a harness-composition fix.

Run the offline unit tests with:

```bash
node --test integrations/memoryagentbench/research/oracle_retrieval_ablation_node_test.mjs
```

## Controlled V3 comparison

`compare_controlled_regression_v3.py` performs a read-only paired comparison of
the frozen 84-question regression. In the controlled V1/V2/V3 artifacts, 216 of
the 300 rows are copied resume/judge controls. The script therefore joins only
the 84 manifest IDs, validates the official GPT-4o prompt pin and source
artifact, and joins each controlled query to its wrap audit. It also includes
the actual historical 65/84 result as a separately labelled accuracy-only
reference.

It produces JSON, Markdown, and a per-question CSV with:

- V3-vs-historical-best, V3-vs-V1, and V3-vs-V2 paired outcomes and exact
  McNemar tests;
- regression-role, failure-category, pipeline-stage, and question-type splits;
- end-to-end query latency, retrieval-agent tokens, tool calls, candidates,
  committed evidence, physical reservoir, and directory exposure metrics.

The historical artifact contains frozen predictions from the older LME-S500
run grafted onto a later MAB300 row template for an official GPT-4o rejudge.
Its original execution has no schema-equivalent `wrap-audits.jsonl`, so the
script intentionally excludes its apparent row-template cost fields.

Run it on the evaluation server only after the V3 suite and official judge have
all 84 target rows:

```bash
python3 integrations/memoryagentbench/research/compare_controlled_regression_v3.py \
  --root /data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830 \
  --output-dir /path/to/read-only-analysis-output
```

`--allow-incomplete` exists only to validate schemas while V3 is in progress;
the resulting report carries warnings and is not a final comparison.

`analyze_controlled_directory_mechanism.py` then audits whether V3 actually
used the compact directory. It defines the initial directory as the compact C
references returned by the first successful semantic search, and counts a
direct read only when the Agent explicitly passes one of those references to
`read`. The report separates reads before a second semantic search, committed
directory memories, and post-hoc gold-directory commits; it does not infer
causality from a paired score flip.

```bash
python3 integrations/memoryagentbench/research/analyze_controlled_directory_mechanism.py \
  --root /data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830 \
  --output-dir /path/to/read-only-analysis-output
```

## Clean full-300 comparison

`compare_clean_full300.py` compares a newly completed clean full-300 run with
the frozen inline-compose-v2 run and the historical-best current-GPT4o
rejudge. Its preparation mode does not accept final artifact paths, so it can
freeze the canonical 300 IDs, source fields, judge prompt, baseline hashes,
and acceptance gate without inspecting an experiment in progress.

```bash
python3 integrations/memoryagentbench/research/compare_clean_full300.py \
  --prepare-only \
  --output-dir /path/to/preparation
```

Final comparison requires a run, official judge, and cleaned audit with exactly
one wrap row for each of all 300 canonical IDs. This rejects the mixed-seed
pattern used by the earlier 84-question controlled runs. It reports paired
flips and exact McNemar tests, question type, inline pipeline stage, comparable
costs, and the trace-linked chain from compact-directory exposure through
explicit read, gold commit, and a correct judged answer.
