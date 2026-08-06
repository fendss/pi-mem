# Dependency Rules

## Context Rules

1. `memory` imports no other domain context.
2. `retrieval` may import only the public API of `memory`.
3. `evidence-agent` may import only the public APIs of `retrieval` and `memory`.
4. `benchmark` may import the public APIs of the other contexts.
5. Cross-context imports target the context `index.ts`, never an internal adapter or implementation file.

## Layer Rules

1. `model` imports neither `use-cases`, `ports`, nor `adapters`.
2. `use-cases` may import `model` and `ports`, but not `adapters`.
3. `ports` use context-owned model types and contain no technology-specific types.
4. `adapters` implement ports and may depend on external libraries.
5. `entrypoints` and `composition` are the outer wiring layers. Reusable cross-context construction belongs in `composition`; command-specific process and artifact wiring stays in `entrypoints`.

## Data Boundaries

- SQLite rows are converted to context models inside SQLite adapters.
- Pi Agent SDK messages stay inside the Pi adapter.
- OpenAI-compatible HTTP payloads stay inside the embedding adapter.
- Benchmark gold fields never cross into `memory`, `retrieval`, or `evidence-agent`.

The inward context direction, public cross-context API rule, and model isolation rule are enforced by `test/architecture/dependency-rules.test.ts`.
