# File Catalog

This generated catalog is the file-level directory for the project. Responsibilities are maintained in `scripts/generate-code-catalog.mjs`; generation fails when a primary source file has no description.

Compatibility facades preserve old import paths during the structural migration. New code must import from the context path named by the facade.

| File | Context | Layer | Status | Responsibility |
|---|---|---|---|---|
| [`src/adapters/longmemeval.ts`](../../src/adapters/longmemeval.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `../benchmark/longmemeval/dataset-adapter.js`. |
| [`src/aggregate-operator.ts`](../../src/aggregate-operator.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/operators/numeric-operator.js`. |
| [`src/async-pool.ts`](../../src/async-pool.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/concurrency/async-pool.js`. |
| [`src/bash-ro.ts`](../../src/bash-ro.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./evidence-agent/adapters/docker/read-only-shell.js`. |
| [`src/benchmark-answer.ts`](../../src/benchmark-answer.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./benchmark/answer-from-evidence.js`. |
| [`src/benchmark/answer-from-evidence.ts`](../../src/benchmark/answer-from-evidence.ts) | benchmark | domain service | internal | Runs the benchmark answer-only model stage from grounded retrieval evidence. |
| [`src/benchmark/index.ts`](../../src/benchmark/index.ts) | benchmark | public API | public | Defines the public API exported by the benchmark context. |
| [`src/benchmark/longmemeval/data-paths.ts`](../../src/benchmark/longmemeval/data-paths.ts) | benchmark | domain service | internal | Defines the filesystem paths used by a LongMemEval workspace. |
| [`src/benchmark/longmemeval/dataset-adapter.ts`](../../src/benchmark/longmemeval/dataset-adapter.ts) | benchmark | domain service | internal | Validates and adapts LongMemEval-S records into PiMem sessions and private questions. |
| [`src/benchmark/longmemeval/private-question-store.ts`](../../src/benchmark/longmemeval/private-question-store.ts) | benchmark | domain service | internal | Reads and atomically updates the private LongMemEval question map. |
| [`src/benchmark/model/benchmark-query.ts`](../../src/benchmark/model/benchmark-query.ts) | benchmark | model | internal | Defines the benchmark question model shared at the benchmark boundary. |
| [`src/benchmark/model/benchmark-run.ts`](../../src/benchmark/model/benchmark-run.ts) | benchmark | model | internal | Defines durable benchmark prediction, success, and failure artifact records. |
| [`src/benchmark/use-cases/run-question.ts`](../../src/benchmark/use-cases/run-question.ts) | benchmark | use case | internal | Runs one question through injected evidence-agent dependencies. |
| [`src/cli.ts`](../../src/cli.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./entrypoints/cli/main.js`. |
| [`src/composition/create-retrieval-context.ts`](../../src/composition/create-retrieval-context.ts) | composition | composition root | internal | Wires a concrete store and optional embedder into the selected retrieval profile. |
| [`src/composition/create-search-operator-registry.ts`](../../src/composition/create-search-operator-registry.ts) | composition | composition root | internal | Registers the allowlisted search operators and freezes their catalog for one runtime. |
| [`src/composition/run-question.ts`](../../src/composition/run-question.ts) | composition | composition root | internal | Builds concrete model, store, and retrieval adapters for one question run. |
| [`src/context.ts`](../../src/context.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./evidence-agent/adapters/pi/ephemeral-context.js`. |
| [`src/database-evidence-operators.ts`](../../src/database-evidence-operators.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/adapters/sqlite/database-evidence-operators.js`. |
| [`src/embedding-index.ts`](../../src/embedding-index.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/index-scope-embeddings.js`. |
| [`src/embedding.ts`](../../src/embedding.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/adapters/openai/openai-compatible-embedder.js`. |
| [`src/entrypoints/cli/commands/benchmark-longmemeval.ts`](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts) | entrypoints | command handler | internal | Executes resumable, concurrent LongMemEval benchmark runs and materializes their artifacts. |
| [`src/entrypoints/cli/commands/ingest-longmemeval.ts`](../../src/entrypoints/cli/commands/ingest-longmemeval.ts) | entrypoints | command handler | internal | Ingests selected LongMemEval scopes and optionally builds embedding indexes. |
| [`src/entrypoints/cli/commands/longmemeval-suite.ts`](../../src/entrypoints/cli/commands/longmemeval-suite.ts) | entrypoints | command handler | internal | Orchestrates the complete benchmark, audit, judge, frozen-reanswer, and packaging suite. |
| [`src/entrypoints/cli/commands/package-benchmark.ts`](../../src/entrypoints/cli/commands/package-benchmark.ts) | entrypoints | command handler | internal | Validates complete benchmark artifacts and creates their archive. |
| [`src/entrypoints/cli/commands/prepare-longmemeval-eval.ts`](../../src/entrypoints/cli/commands/prepare-longmemeval-eval.ts) | entrypoints | command handler | internal | Joins predictions with source answers into evaluator input records. |
| [`src/entrypoints/cli/commands/run-longmemeval.ts`](../../src/entrypoints/cli/commands/run-longmemeval.ts) | entrypoints | command handler | internal | Runs retrieval and answer generation for one stored private LongMemEval question. |
| [`src/entrypoints/cli/commands/run-memory.ts`](../../src/entrypoints/cli/commands/run-memory.ts) | entrypoints | command handler | internal | Runs one arbitrary question against a selected memory scope. |
| [`src/entrypoints/cli/main.ts`](../../src/entrypoints/cli/main.ts) | entrypoints | entry point | internal | Routes CLI commands and normalizes top-level errors. |
| [`src/entrypoints/cli/parse-command.ts`](../../src/entrypoints/cli/parse-command.ts) | entrypoints | entrypoint support | internal | Parses CLI arguments, validates flags, and derives model and retrieval options. |
| [`src/entrypoints/cli/workflow-files.ts`](../../src/entrypoints/cli/workflow-files.ts) | entrypoints | entrypoint support | internal | Provides atomic workflow file writes, optional JSON reads, and archive command execution. |
| [`src/entrypoints/ldbd-api/contracts.ts`](../../src/entrypoints/ldbd-api/contracts.ts) | entrypoints | entrypoint support | internal | Validates and normalizes the LDBD Add/Search wire contracts. |
| [`src/entrypoints/ldbd-api/main.ts`](../../src/entrypoints/ldbd-api/main.ts) | entrypoints | entrypoint support | internal | Starts the authenticated HTTP server for the LDBD memory API. |
| [`src/entrypoints/ldbd-api/pimem-runtime.ts`](../../src/entrypoints/ldbd-api/pimem-runtime.ts) | entrypoints | entrypoint support | internal | Materializes LDBD user messages as immutable scopes and runs PiMem retrieval. |
| [`src/entrypoints/ldbd-api/service.ts`](../../src/entrypoints/ldbd-api/service.ts) | entrypoints | entrypoint support | internal | Maps validated LDBD requests to inbox persistence and PiMem search. |
| [`src/evidence-agent/adapters/docker/read-only-shell.ts`](../../src/evidence-agent/adapters/docker/read-only-shell.ts) | evidence-agent | adapter | internal | Runs allowlisted read-only shell commands in the memory-scope container. |
| [`src/evidence-agent/adapters/pi/ephemeral-context.ts`](../../src/evidence-agent/adapters/pi/ephemeral-context.ts) | evidence-agent | adapter | internal | Builds the bounded ephemeral context passed to the Pi agent. |
| [`src/evidence-agent/adapters/pi/tools.ts`](../../src/evidence-agent/adapters/pi/tools.ts) | evidence-agent | adapter | internal | Exports the Pi tool adapter API from its responsibility-specific modules. |
| [`src/evidence-agent/adapters/pi/tools/bash-tool.ts`](../../src/evidence-agent/adapters/pi/tools/bash-tool.ts) | evidence-agent | adapter | internal | Adapts the read-only shell capability to the Pi bash tool contract. |
| [`src/evidence-agent/adapters/pi/tools/candidate-refs.ts`](../../src/evidence-agent/adapters/pi/tools/candidate-refs.ts) | evidence-agent | adapter | internal | Resolves and validates candidate references used by agent tools. |
| [`src/evidence-agent/adapters/pi/tools/contracts.ts`](../../src/evidence-agent/adapters/pi/tools/contracts.ts) | evidence-agent | adapter | internal | Defines stores, runtime state, and shared contracts required by Pi tools. |
| [`src/evidence-agent/adapters/pi/tools/create-tools.ts`](../../src/evidence-agent/adapters/pi/tools/create-tools.ts) | evidence-agent | adapter | internal | Creates the complete Pi tool set for one evidence-agent run. |
| [`src/evidence-agent/adapters/pi/tools/finish-tool.ts`](../../src/evidence-agent/adapters/pi/tools/finish-tool.ts) | evidence-agent | adapter | internal | Validates and records the agent's final evidence-backed answer. |
| [`src/evidence-agent/adapters/pi/tools/read-tool.ts`](../../src/evidence-agent/adapters/pi/tools/read-tool.ts) | evidence-agent | adapter | internal | Reads exact candidate memories and registers them as evidence. |
| [`src/evidence-agent/adapters/pi/tools/render-tool-result.ts`](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts) | evidence-agent | adapter | internal | Renders structured tool results into the text observed by the agent. |
| [`src/evidence-agent/adapters/pi/tools/schemas.ts`](../../src/evidence-agent/adapters/pi/tools/schemas.ts) | evidence-agent | adapter | internal | Defines TypeBox input schemas for the Pi tools. |
| [`src/evidence-agent/adapters/pi/tools/search-tool.ts`](../../src/evidence-agent/adapters/pi/tools/search-tool.ts) | evidence-agent | adapter | internal | Adapts retrieval orchestration to the Pi search-memory tool. |
| [`src/evidence-agent/adapters/pi/tools/tool-protocol.ts`](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts) | evidence-agent | adapter | internal | Defines tool-call counting, time limits, and protocol errors. |
| [`src/evidence-agent/index.ts`](../../src/evidence-agent/index.ts) | evidence-agent | public API | public | Defines the public API exported by the evidence-agent context. |
| [`src/evidence-agent/model/evidence.ts`](../../src/evidence-agent/model/evidence.ts) | evidence-agent | model | internal | Defines candidates, evidence, citations, metrics, and final agent results. |
| [`src/evidence-agent/model/memory-ledger.ts`](../../src/evidence-agent/model/memory-ledger.ts) | evidence-agent | model | internal | Tracks searched candidates, exact reads, evidence, and provenance during a run. |
| [`src/evidence-agent/run-pimem.ts`](../../src/evidence-agent/run-pimem.ts) | evidence-agent | domain service | internal | Runs the Pi evidence agent and assembles its source-grounded result. |
| [`src/evidence-fact-index.ts`](../../src/evidence-fact-index.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/adapters/sqlite/evidence-fact-index.js`. |
| [`src/hybrid-search.ts`](../../src/hybrid-search.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/operators/hybrid-search.js`. |
| [`src/ingest.ts`](../../src/ingest.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./memory/ingest-memory-sessions.js`. |
| [`src/jsonl-writer.ts`](../../src/jsonl-writer.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/filesystem/jsonl-writer.js`. |
| [`src/ledger.ts`](../../src/ledger.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./evidence-agent/model/memory-ledger.js`. |
| [`src/memory/index.ts`](../../src/memory/index.ts) | memory | public API | public | Defines the public API exported by the memory context. |
| [`src/memory/ingest-memory-sessions.ts`](../../src/memory/ingest-memory-sessions.ts) | memory | domain service | internal | Validates and ingests immutable memory sessions through the ingest port. |
| [`src/memory/model/memory.ts`](../../src/memory/model/memory.ts) | memory | model | internal | Defines source-memory, session, scope, ingest, and export domain models. |
| [`src/memory/ports/memory-ingest-store.ts`](../../src/memory/ports/memory-ingest-store.ts) | memory | port | internal | Defines the store operations required by the memory ingest use case. |
| [`src/model.ts`](../../src/model.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/pi/load-model-runtime.js`. |
| [`src/platform/concurrency/async-pool.ts`](../../src/platform/concurrency/async-pool.ts) | platform | platform adapter | internal | Runs bounded concurrent work with stable slot identities. |
| [`src/platform/concurrency/request-gate.ts`](../../src/platform/concurrency/request-gate.ts) | platform | platform adapter | internal | Limits concurrent requests and request-start rate. |
| [`src/platform/filesystem/jsonl-writer.ts`](../../src/platform/filesystem/jsonl-writer.ts) | platform | platform adapter | internal | Serializes append-only JSONL writes through a single promise chain. |
| [`src/platform/pi/load-model-runtime.ts`](../../src/platform/pi/load-model-runtime.ts) | platform | platform adapter | internal | Loads and validates the configured Pi model runtime. |
| [`src/platform/pi/openai-non-stream-transport.ts`](../../src/platform/pi/openai-non-stream-transport.ts) | platform | platform adapter | internal | Adapts complete OpenAI Chat Completions responses to the Pi agent event protocol. |
| [`src/platform/security/protected-environment.ts`](../../src/platform/security/protected-environment.ts) | platform | platform adapter | internal | Loads permission-restricted environment files and validates required variables. |
| [`src/platform/sqlite-memory-store.ts`](../../src/platform/sqlite-memory-store.ts) | platform | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./sqlite/pimem-store.js`. |
| [`src/platform/sqlite/memory-row.ts`](../../src/platform/sqlite/memory-row.ts) | platform | platform adapter | internal | Maps the shared SQLite memory row shape to the memory domain model. |
| [`src/platform/sqlite/pimem-store.ts`](../../src/platform/sqlite/pimem-store.ts) | platform | platform adapter | internal | Implements memory persistence, FTS search, embedding storage, and fact gateways in SQLite. |
| [`src/protected-env.ts`](../../src/protected-env.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/security/protected-environment.js`. |
| [`src/ranking.ts`](../../src/ranking.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/ranking.js`. |
| [`src/request-gate.ts`](../../src/request-gate.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/concurrency/request-gate.js`. |
| [`src/retrieval-profile.ts`](../../src/retrieval-profile.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/retrieval-profile.js`. |
| [`src/retrieval/adapters/openai/openai-compatible-embedder.ts`](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts) | retrieval | adapter | internal | Implements the embedder port with an OpenAI-compatible embeddings endpoint. |
| [`src/retrieval/adapters/operators/builtins.ts`](../../src/retrieval/adapters/operators/builtins.ts) | retrieval | adapter | internal | Implements the built-in search operators over injected retrieval capabilities. |
| [`src/retrieval/adapters/sqlite/database-evidence-operators.ts`](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts) | retrieval | adapter | internal | Implements temporal and numeric evidence-operator queries over SQLite. |
| [`src/retrieval/adapters/sqlite/evidence-fact-index.ts`](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts) | retrieval | adapter | internal | Builds and inspects normalized temporal and numeric fact indexes in SQLite. |
| [`src/retrieval/finalize-search-hits.ts`](../../src/retrieval/finalize-search-hits.ts) | retrieval | domain service | internal | Deduplicates, orders, and limits retrieval hits at the search boundary. |
| [`src/retrieval/index-scope-embeddings.ts`](../../src/retrieval/index-scope-embeddings.ts) | retrieval | domain service | internal | Builds or refreshes the embedding index for one memory scope. |
| [`src/retrieval/index.ts`](../../src/retrieval/index.ts) | retrieval | public API | public | Defines the public API exported by the retrieval context. |
| [`src/retrieval/model/embedder.ts`](../../src/retrieval/model/embedder.ts) | retrieval | model | internal | Defines the technology-neutral embedding port. |
| [`src/retrieval/model/embedding.ts`](../../src/retrieval/model/embedding.ts) | retrieval | model | internal | Defines embedding profiles, stored vectors, and embedding-index contracts. |
| [`src/retrieval/model/retrieval.ts`](../../src/retrieval/model/retrieval.ts) | retrieval | model | internal | Defines retrieval requests, hits, evidence sidecars, profiles, and metrics. |
| [`src/retrieval/model/search-operator.ts`](../../src/retrieval/model/search-operator.ts) | retrieval | model | internal | Defines search-operator inputs, outputs, catalog metadata, and execution context. |
| [`src/retrieval/operators/hybrid-search.ts`](../../src/retrieval/operators/hybrid-search.ts) | retrieval | operator | internal | Combines FTS and vector results using reciprocal-rank fusion. |
| [`src/retrieval/operators/numeric-operator.ts`](../../src/retrieval/operators/numeric-operator.ts) | retrieval | operator | internal | Normalizes numeric constraints and executes numeric evidence queries. |
| [`src/retrieval/operators/temporal-operator.ts`](../../src/retrieval/operators/temporal-operator.ts) | retrieval | operator | internal | Normalizes temporal constraints and executes temporal evidence queries. |
| [`src/retrieval/ports/memory-tool-store.ts`](../../src/retrieval/ports/memory-tool-store.ts) | retrieval | port | internal | Defines the candidate-search and exact-read capabilities used by retrieval and evidence tools. |
| [`src/retrieval/ports/search-operator.ts`](../../src/retrieval/ports/search-operator.ts) | retrieval | port | internal | Defines the stable candidate-only search-operator SPI. |
| [`src/retrieval/ranking.ts`](../../src/retrieval/ranking.ts) | retrieval | domain service | internal | Defines deterministic retrieval ranking and reciprocal-rank fusion helpers. |
| [`src/retrieval/retrieval-profile.ts`](../../src/retrieval/retrieval-profile.ts) | retrieval | domain service | internal | Resolves retrieval-profile names and creates profile-specific stores. |
| [`src/retrieval/search-memory.ts`](../../src/retrieval/search-memory.ts) | retrieval | domain service | internal | Normalizes agent search calls and dispatches them through the frozen operator registry. |
| [`src/retrieval/temporal-annotation.ts`](../../src/retrieval/temporal-annotation.ts) | retrieval | domain service | internal | Parses and annotates temporal facts present in memory text. |
| [`src/retrieval/use-cases/execute-operator.ts`](../../src/retrieval/use-cases/execute-operator.ts) | retrieval | use case | internal | Executes one registered search operator and enforces result scope isolation. |
| [`src/retrieval/use-cases/operator-registry.ts`](../../src/retrieval/use-cases/operator-registry.ts) | retrieval | use case | internal | Registers, validates, freezes, and describes the search-operator catalog. |
| [`src/runtime.ts`](../../src/runtime.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./evidence-agent/run-pimem.js`. |
| [`src/search-results.ts`](../../src/search-results.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/finalize-search-hits.js`. |
| [`src/store.ts`](../../src/store.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./platform/sqlite/pimem-store.js`. |
| [`src/temporal.ts`](../../src/temporal.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/temporal-annotation.js`. |
| [`src/timeline-operator.ts`](../../src/timeline-operator.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./retrieval/operators/temporal-operator.js`. |
| [`src/tools.ts`](../../src/tools.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./evidence-agent/adapters/pi/tools.js`. |
| [`src/types.ts`](../../src/types.ts) | compatibility | compatibility facade | compatibility | Preserves a pre-refactor import path by re-exporting `./memory/index.js`, `./retrieval/index.js`, `./evidence-agent/index.js`, `./benchmark/index.js`. |
| [`src/util.ts`](../../src/util.ts) | shared | domain service | internal | Provides shared hashing, safe path, source-text, and preview helpers. |
