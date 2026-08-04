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

## Conclusion

PersonaMem does confirm that the cited-only Answer projection is too lossy: exact gold-message recall falls from 35.41% in Candidates to 16.97% in Answer context. It does **not** support a blanket policy of sending every Candidate to Answer.

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
```
