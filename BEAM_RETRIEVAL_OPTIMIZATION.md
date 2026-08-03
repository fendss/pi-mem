# BEAM Retrieval Optimization

## Boundary

- Production remains on `pimem-retrieval-v5-simple-operator-routing`.
- The fixed BEAM Answer prompt, `gpt-4o-mini`, and Judge pipeline are unchanged.
- Retrieval experiments received only Search requests and scoped memories. Gold evidence, rubrics, answers, and scores were joined only after each run completed.
- No Answer or Judge calls were made for these retrieval-stage experiments.

## Stage 1: expand deterministic coverage candidates

The previous coverage reducer grouped candidates by session and retained at most four memories from each session. This removed independent events when several required facts occurred in the same session.

The candidate implementation:

1. raises the coverage result budget from 40 to 60;
2. preserves the prior session-diverse top 40;
3. selects additional candidates rank-by-rank across independent queries;
4. allows a session to contribute through multiple evidence-need queries;
5. puts a bounded query-fair tranche first for Agent attention.

A gold-blind replay of the original 600 Agent search traces produced:

| Metric | Baseline | Expanded coverage |
|---|---:|---:|
| Mean candidate count | 36.39 | 43.33 |
| Near-1 evidence-group recall | 42.34% | 48.64% |
| Questions with all evidence groups | 42.88% | 49.63% |
| BEAM-100K near-1 recall | 59.71% | 69.06% |
| BEAM-1M near-1 recall | 28.70% | 32.62% |
| Event-ordering near-1 recall | 34.19% | 38.18% |
| Summarization near-1 recall | 21.33% | 29.99% |

Artifact:

```text
/data/zhaogangyi/pi-mem-deploy-candidates/beam-coverage-v1/
coverage-recall-replay-v2-20260803T143316Z/COVERAGE_REPLAY_RESULT.json
```

## Stage 2: optimize Agent coverage behavior

Candidate harness:

```text
pimem-retrieval-v6-query-fair-verification
```

It keeps model-owned routing and adds:

- a private evidence-demand ledger;
- bounded follow-up retrieval for multi-slot/open-coverage requests;
- query/facet-aware reading;
- non-minimal citation preservation;
- stricter direct-source sufficiency language;
- a neutral v6 question protocol without deterministic keyword routing.

Pinned hashes:

```text
v6 system prompt:
a28a587aa6967fcd335917e336280ebabce6dc38d48038f4b3f1c754b2b7ab30

v6 model interface:
3e246bb972061f5a145842cd4406af066f834b663f49ad2c8a774fb3405e854f
```

A deterministic 100-question stratified request manifest was run once per candidate. On the final v6 candidate:

| Metric | Same-question v5 baseline | v6 candidate |
|---|---:|---:|
| Mean Search calls | 1.37 | 1.56 |
| Mean planned queries | 4.28 | 5.79 |
| Mean candidates | 34.27 | 72.57 |
| Mean read memories | 13.63 | 14.80 |
| Mean cited memories | 3.63 | 4.64 |
| Candidate near-1 group recall | 28.13% | 49.90% |
| Read near-1 group recall | 23.20% | 32.65% |
| Cited near-1 group recall | 18.69% | 21.15% |
| Candidate-complete questions | 38.89% | 66.67% |
| Read-complete questions | 35.56% | 41.11% |
| Cited-complete questions | 24.44% | 25.56% |
| Abstention marked sufficient | 10/10 | 9/10 |

Artifact:

```text
/data/zhaogangyi/pi-mem-deploy-candidates/beam-v6-candidate/
RETRIEVAL_V6C_100_RESULT.json
```

## Rejected guardrail

A later experiment required every Agent-planned coverage query to have a citation before accepting `sufficient`. It increased Search calls and candidate recall, but reduced cited evidence recall from 21.15% to 15.61% and caused broad over-retrieval. It is not included in the candidate implementation.

## Decision

The combined candidate substantially improves candidate and read recall. The remaining bottleneck is candidate/read-to-citation contraction, especially for event ordering, summarization, and abstention calibration. Do not deploy v6 to production until a larger retrieval-only acceptance confirms that improvement without regressions on single-fact, temporal, and preference tasks.
