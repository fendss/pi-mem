# PersonaMem-v2 32k Attribution

## Scope

This analysis uses the 600 PersonaMem-v2 32k questions already ingested and searched in Leaderboard v2. The official Search artifacts were sealed before gold fields were loaded. The offline attribution made no Add, Search, Answer, Judge, or model-provider calls.

A separate paired 100-question Answer pilot was selected by `sha256(qa_id)`, independently of labels. It compares context projections under one fixed candidate prompt and `gpt-4o-mini-2024-07-18` at temperature 0. Qwen reranking was performed once per question over the global deduplicated candidate set, using the original question and options, without gold access.

## Official 600-question result

```text
Official accuracy:          206/600 = 34.33%
Mean Candidates:             15.83
Mean Read memories:          14.01
Mean cited memories:          3.97
Mean Answer raw memories:     3.43
Mean Answer memory chars:  4,986
```

### Exact gold-evidence attrition

| Stage | Mean memories | Gold-message recall | Any-gold questions | Complete-gold questions |
|---|---:|---:|---:|---:|
| Candidate | 15.83 | 35.41% | 45.00% | 19.33% |
| Read | 14.01 | 33.60% | 43.67% | 18.00% |
| Cited | 3.97 | 16.97% | 33.67% | 2.67% |
| Answer | 3.43 | 16.97% | 33.67% | 2.67% |

The Candidate-to-Read boundary is relatively conservative, while Citation/Answer projection removes about half of the exact gold-message recall. However, PersonaMem also has a substantial first-stage retrieval miss: only 19.33% of questions have every exact gold message in Candidates.

### Attribution of the 394 official wrong answers

| Earliest observable failure | Count | Share of wrong answers |
|---|---:|---:|
| Candidate missing exact gold evidence | 316 | 80.20% |
| Candidate complete, Read incomplete | 8 | 2.03% |
| Read complete, Citation/Answer projection incomplete | 61 | 15.48% |
| Cited complete, Answer still wrong | 9 | 2.28% |

There are 69 wrong questions where Candidates contain all exact gold evidence but Citations do not. These are the most direct opportunities for a final evidence projector. The strict exact-message criterion is diagnostic rather than a claim that every gold message is always necessary.

### Observational context-size relationship

| Answer raw memories | Questions | Official accuracy |
|---|---:|---:|
| 0–2 | 137 | 30.66% |
| 3–4 | 409 | 34.72% |
| 5–6 | 34 | 35.29% |
| 7+ | 20 | 50.00% |

This correlation is compatible with a short-context problem, but it is not causal because the Retrieval Agent selects context size. The 7+ bucket is also small.

## Paired 100-question Answer pilot

The candidate prompt used the official PersonaMem-v2 MCQ template and model, plus a versioned retrieved-evidence wrapper. It is not claimed to be byte-identical to the evaluator owner's private orchestration. Re-running the current cited context agreed with the archived official label on 70% of the fixed subset; its accuracy was 44%, versus 36% for the archived official outputs on the same subset. Therefore the paired deltas below are internally controlled, while their absolute values are not official leaderboard scores.

| Variant | Mean memories | Mean memory chars | Accuracy |
|---|---:|---:|---:|
| Current cited projection | 3.45 | 5,127 | 44% |
| All Candidates, Top-30, original order | 13.12 | 11,869 | 42% |
| All Candidates, Top-30, final Qwen order | 13.12 | 11,915 | 41% |

Paired transitions:

```text
Current cited → all Candidates:
  improved: 7
  regressed: 9
  McNemar exact p = 0.804

All Candidates → final Qwen ordering:
  improved: 5
  regressed: 6
  McNemar exact p = 1.000

Current cited → final Qwen ordering:
  improved: 8
  regressed: 11
  McNemar exact p = 0.648
```

Blindly increasing context from 3.45 to 13.12 memories did not improve aggregate accuracy on this fixed pilot. Reordering the same global candidate set with the current direct-relevance reranker also did not help.

Category movement is heterogeneous. For example, all-Candidate context improved `ask_to_forget` from 13.04% to 30.43% on 23 pilot questions, but reduced health/medical from 70.59% to 52.94%, neutral preferences from 61.54% to 46.15%, and therapy background from 28.57% to 14.29%. These cells are small, but the direction is consistent with PersonaMem's design: additional semantically relevant memory can be harmful when it refers to another person, has been superseded or forgotten, or contains sensitive information that should not drive personalization.

## Full 600-question retrieved-session and Gold-oracle experiment

A follow-up full-suite experiment used the upstream PersonaMem-v2 role-preserving message contract instead of the pilot's bullet-list evidence wrapper.

- `retrieved_session_dedup_top30`: all immutable memories discovered during the one Retrieval Agent run, deduplicated by ID, truncated to the first 30 in retrieval order, then ordered chronologically for Answer.
- `gold_memories_oracle`: every annotated PersonaMem gold memory, with original roles and contents, passed directly to Answer. Gold was accessed only by this explicit oracle branch after Search had already completed.

All 1,200 Answer calls returned `gpt-4o-mini-2024-07-18`; temperature was 0. No best-of selection was performed.

| Condition | Correct | Accuracy | Mean memories | Mean memory chars |
|---|---:|---:|---:|---:|
| Official Leaderboard cited-only | 206/600 | 34.33% | 3.43 | 4,986 |
| Retrieved session, dedup, Top-30 | 267/600 | 44.50% | 13.99 | 10,011 |
| All Gold memories oracle | 336/600 | 56.00% | 2.95 | 1,736 |

Paired transitions:

```text
Official → retrieved-session Top-30:
  official wrong → retrieved correct: 106
  official correct → retrieved wrong: 45
  net: +61 questions / +10.17 points
  McNemar exact p = 7.49e-7

Retrieved-session Top-30 → Gold oracle:
  retrieved wrong → Gold correct: 111
  retrieved correct → Gold wrong: 42
  net: +69 questions / +11.50 points
  McNemar exact p = 2.25e-8

Official → Gold oracle:
  official wrong → Gold correct: 156
  official correct → Gold wrong: 26
  net: +130 questions / +21.67 points
  McNemar exact p = 8.57e-24
```

Category accuracy:

| Category | Official | Retrieved Top-30 | Gold oracle |
|---|---:|---:|---:|
| anti-stereotypical preference | 41.51% | 49.06% | 66.98% |
| ask to forget | 9.65% | 15.79% | 33.33% |
| health/medical | 50.00% | 65.28% | 72.22% |
| neutral preferences | 40.82% | 43.88% | 71.43% |
| sensitive information | 29.17% | 40.28% | 30.56% |
| stereotypical preference | 50.00% | 65.28% | 68.06% |
| therapy background | 27.27% | 46.97% | 51.52% |

The Gold condition is an empirical oracle score, not a mathematical upper bound: the model can still misuse gold evidence, especially for forgetting and sensitive-information questions. Gold even underperforms the broader retrieved context on sensitive information, showing that relevance alone does not tell the model whether information is permitted to influence personalization.

## Top-30 plus additional Pi-Mem products

A second 600-question condition kept exactly the same deduplicated Top-30 raw memories and supplemented them with all bounded Pi-Mem products available in the sealed trace:

- selection status;
- `evidenceSummary`;
- candidate/read/cited/search counts;
- planned retrieval queries;
- Agent citation-support statements;
- Top-30 inventory with role, time, turn, read/cited flags, query, and discovery rank.

No Gold field was used. Generated summaries and support statements were explicitly labeled as navigation hints that must be checked against raw memories.

| Condition | Correct | Accuracy | Mean total context chars |
|---|---:|---:|---:|
| Retrieved session Top-30 | 267/600 | 44.50% | 10,011 |
| Top-30 + Pi-Mem products | 223/600 | 37.17% | 14,135 |
| Gold memories oracle | 336/600 | 56.00% | 1,736 |

The added Pi-Mem block averaged 3,845 characters. Paired against raw Top-30:

```text
Top-30 correct → products wrong: 88
Top-30 wrong → products correct: 44
net: -44 questions / -7.33 points
same answer letter: 402/600
McNemar exact p = 1.60e-4
```

Category accuracy:

| Category | Raw Top-30 | Top-30 + products | Change |
|---|---:|---:|---:|
| anti-stereotypical preference | 49.06% | 45.28% | -3.78 |
| ask to forget | 15.79% | 15.79% | 0.00 |
| health/medical | 65.28% | 54.17% | -11.11 |
| neutral preferences | 43.88% | 40.82% | -3.06 |
| sensitive information | 40.28% | 23.61% | -16.67 |
| stereotypical preference | 65.28% | 56.94% | -8.34 |
| therapy background | 46.97% | 30.30% | -16.67 |

The regression is not explained by Pi-Mem's `insufficient` status: 86 of the 88 degraded questions had status `sufficient`. Qualitative inspection shows that evidence summaries often restate sensitive attributes or directly personalize from medically or therapeutically related memories. This makes generated retrieval products more authoritative and salient even when PersonaMem expects the model not to use that information.

This condition intentionally combines all products, so it does not identify whether the main harm comes from `evidenceSummary`, citation support, or inventory clutter. A component ablation would be required for that attribution.

## Conclusion

The full experiments change the diagnosis:

1. **Answer projection/context packaging is a major loss.** Returning all deduplicated retrieved memories with roles and chronology improves 34.33% to 44.50%.
2. **Retrieval/evidence quality remains comparably important.** Replacing retrieved context with exact Gold memories improves another 11.50 points to 56.00%.
3. **Context length alone is not the key variable.** Gold uses only 2.95 memories and 1,736 characters on average, yet substantially outperforms the 13.99-memory retrieved context. Relevance, state, ownership, and policy correctness matter more than raw length.
4. **The Answer model/prompt has a large residual ceiling.** Even with exact Gold memories, `gpt-4o-mini` misses 44% of PersonaMem questions, especially forgetting and sensitive-information cases.
5. **Generated Pi-Mem products must not be appended wholesale.** Adding summary, citation, query, count, and inventory products to the same Top-30 significantly reduces accuracy from 44.50% to 37.17%.

PersonaMem therefore confirms that cited-only projection is too lossy, but the correct replacement is a state-aware final evidence packager rather than unconditional context expansion or wholesale serialization of internal retrieval products.

The current final reranker scores direct relevance, but PersonaMem requires more than relevance:

- current state versus superseded state;
- explicit forget/update instructions;
- whether a preference belongs to the user or another person;
- whether sensitive information is permitted to affect personalization;
- paired conversational context rather than isolated topical messages.

The next candidate should therefore be a global final evidence packager rather than an online per-query reranker, but it must preserve state, entity ownership, and privacy/consent evidence. A useful next ablation is:

```text
Candidates
→ exact-ID deduplication
→ latest-state / ownership / direct-source constraints
→ one global reranker call
→ cited memories mandatory
→ Top-K = 6 / 10 / 15 / 30
→ fixed Answer
```

No production change is justified by the current pilot.

## Artifacts

```text
/data/zhaogangyi/pi-mem-eval/personamem-v2-32k-attribution-20260804/
/data/zhaogangyi/pi-mem-eval/personamem-v2-32k-context-ablation-20260804/
/data/zhaogangyi/pi-mem-eval/personamem-v2-32k-upper-bound-20260804/
/data/zhaogangyi/pi-mem-eval/personamem-v2-32k-top30-plus-products-20260804/
```
