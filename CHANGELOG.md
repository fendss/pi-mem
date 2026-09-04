# Changelog

## Unreleased

- Added the `pimem-hybrid-qdrant-hnsw-v1` retrieval profile behind the existing
  dense-retriever port while retaining SQLite exact dense search as the
  regression baseline.
- Qdrant contributes a fail-open expansion lane to three-way RRF with SQLite
  exact dense and FTS5 instead of replacing the exact dense lane.
- Added resumable, fingerprinted vector generations with a durable SQLite
  outbox, bounded concurrent Qdrant synchronization, index/count verification,
  and fail-closed scope coverage checks.
- Revalidate every Qdrant result against immutable SQLite scope, content hash,
  session, role, timestamp, and deterministic point identity before it enters
  the Candidate pipeline.
- Versioned Qdrant payloads and point identities include the generation, so
  multiple immutable generations can coexist in one collection without
  overwriting each other.
- LDBD service composition can select the same Qdrant profile; sealed online
  scopes derive corpus-fingerprinted generations while the Agent tool protocol
  remains unchanged.

## 1.2.0

- Organized the runtime as explicit `memory`, `retrieval`, `evidence-agent`,
  `agent-runtime`, and `benchmark` bounded contexts.
- Moved Pi-specific answer execution behind the benchmark adapter boundary and
  kept benchmark prompts and results in the domain model.
- Consolidated private JSONL persistence into one filesystem adapter with
  question- and scope-specific identities at the CLI boundary.
- Shortened core filenames and removed obsolete compatibility aliases without
  changing the public `search` → `read` → `finish` protocol.
- Removed one-off local ablation scripts and internal research notes from the
  release source tree; they remain available in repository history.
- Added MemoryAgentBench integration tests to the standard release check.

## 1.1.0

- Added extensible retrieval operators, exact evidence retention, benchmark
  integrations, and reproducible runtime identities.
