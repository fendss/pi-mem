# Retrieval Model Interface Audit: Before and After Qdrant

## Scope

This audit separates the Qdrant backend change from later Retrieval Harness and Answer Adapter experiments.

Compared artifacts:

- validated pre-Qdrant 356/500 source snapshot:
  `/home/zhaogangyi/pi-mem-runs/full-500-v0.2-consistent-evidence-package-v3-r1/source/`
- first Qdrant LongMemEval runner commit: `5a6df90`
- currently restored source: `c1007dd`
- currently deployed public source: `cfd6b1c`

The Retrieval model interface hash covers:

1. Harness version;
2. complete Retrieval system prompt;
3. complete Retrieval skill text;
4. tool names, labels, descriptions, and JSON schemas.

## Result

Qdrant itself did **not** change the Retrieval model interface.

| Version | Retrieval interface SHA-256 | System prompt SHA-256 |
|---|---|---|
| validated pre-Qdrant snapshot | `d361baf96f2e7056f975a9c60aa5f5e6205e6d1856c1ff2dc258a3435d64b0ca` | `b7639320177c563fb0ffad2289a221192fd435d96336278a66b7cfee45cec64f` |
| first Qdrant runner `5a6df90` | identical | identical |
| restored source `c1007dd` | identical | identical |
| deployed `cfd6b1c` | `25fcd0d8d3374cecaa08d89bcb42adf775debebc9d8f7256121ae8ad3b8f1e85` | `8612689ee2ec7ae0477810eea34c43a543ccdf50611d5b96a3ef92b363579248` |

The pre-Qdrant and restored interfaces expose exactly these tools:

- `search(operator, queries, limit)`
- `read(candidateRefs, contextBefore, contextAfter)`
- `bash_ro(command)`
- `finish(status, citations, evidenceSummary, count, inventory)`

The compiled interface objects are byte-equivalent after canonical `JSON.stringify` serialization.

## Qdrant-only code differences

Between the archived pre-Qdrant source and `5a6df90`, the model-relevant runtime changes were internal only:

- Search/Read storage calls became awaitable;
- `AbortSignal` was propagated;
- SQLite exact-record retrieval became awaitable;
- `bash_ro` received an explicit backing store;
- external cancellation was added.

No tool name, description, parameter schema, system instruction, retrieval skill, context transformation, or question-plan text changed.

The Pi model libraries also remained:

- `@earendil-works/pi-agent-core 0.82.1`
- `@earendil-works/pi-ai 0.82.1`

The benchmark runner overrides the configured provider base URL and API key from protected runner environment files, so the provider alias change from `pimem-openai` to `zgy-openai` does not change the actual OpenAI-compatible endpoint used by these runs. The model ID remains `gpt-4o-mini`.

## Tool-result parity

For the paired historical SQLite run and Qdrant slots-16 run:

- 70 questions emitted exactly the same first Search arguments;
- all 70 returned the same ordered candidate IDs;
- all 70 returned byte-identical model-visible Search tool content.

Separately, 200 real Agent hybrid queries achieved 100% Recall@400 and 100% Top-20 overlap against SQLite exact retrieval.

Therefore, with equal Agent-generated Search arguments, the database migration did not alter what the model observed.

## Changes that happened after Qdrant

Later experiments—not Qdrant—changed model behavior:

- `1fcb139` changed the Retrieval system prompt from hash `b763...` to `861268...`;
- `ccebbbb` added stricter Finish/ledger rejection behavior;
- `e4dde01` forced `temperature: 0` in the hosted-model payload;
- v8/v9 changed Finish ordering, explicit Read requirements, and no-progress messages;
- the LongMemEval Answer Adapter changed from `longmemeval-answer-v3` in the 356 run to the currently fixed `longmemeval-answer-v4`.

The first four Retrieval changes have been removed from the restored source. The Answer v4 boundary remains unchanged by explicit requirement, so the complete Retrieval-plus-Answer pipeline is not byte-identical to the historical 356 run even though the Retrieval Agent interface now is.

## Regression guard

`test/model-interface.test.ts` fails if the restored Retrieval model interface differs from the archived pre-Qdrant hash.
