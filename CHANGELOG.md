# Changelog

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
