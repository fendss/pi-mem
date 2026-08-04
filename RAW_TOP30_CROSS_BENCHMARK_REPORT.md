# Raw Top-30 Answer Ablation: LongMemEval-S and ScriptMem-v19

## Historical claim audit

There was no prior strict `raw retrieved memories Top-30 only` experiment on either benchmark.

The earlier evidence was narrower:

1. **LongMemEval-S (2026-07-31):** the Agent selection package plus cited raw memories scored 348/500 (69.60%), while a frozen replay containing all searched raw memories scored 316/500 (63.20%). The raw replay averaged 43.66 memories and reached 171, so this comparison did not isolate Agent products from context overload.
2. **ScriptMem-v19 (2026-07-31):** on one Qdrant retrieval source, an expanded bundle scored 224/457 (49.02%) versus 193/457 (42.23%) for cited-only. The expanded treatment combined the Agent package with read/candidate memories; it was not a raw Top-30 treatment. A later native-memory run used Agent package plus cited raw memories and scored 301/457 (65.86%).

Therefore the historical result never established a benchmark-independent claim that `Agent products + memories` is better than raw Top-30.

## New experiment contracts

Both experiments reuse sealed retrieval artifacts. No Add, Search, retrieval Agent, reranking, or Gold access occurs during Answer construction.

### LongMemEval-S

- Retrieval source: `full-qdrant-slots16-prompt-v4-r1`.
- Select the first 30 unique immutable `searchedMemories` in existing retrieval order.
- Answer input contains only raw memory role/speaker, timestamp, immutable content, and the question.
- No selection package, `evidenceSummary`, citation support, count, inventory, or reasoning trace.
- Answer model: `gpt-4o-mini-2024-07-18`.
- Judge: `Qwen/Qwen3-14B`, same strict prompt hash as the historical run.
- Mean selected memories: 26.53; range 20–30.

### ScriptMem-v19

- Retrieval source: `pimem-scriptmem-native-v1-qdrant-gpt54-slots16-r1`.
- Select the first 30 unique immutable `searched_memories` in existing retrieval order.
- Answer input contains only source session/turn/speaker, immutable raw text, and the original question/options.
- No status, `evidenceSummary`, citation support, count, inventory, candidate metadata, or reasoning trace.
- Answer model: `gpt-5.4-mini-2026-03-17`, matching the controlled native Agent-package baseline.
- Evaluator: ScriptMem-v19 strict deterministic option-label parser.
- Mean selected memories: 27.65; range 5–30.

All Agent citations were already inside the raw Top-30 for both benchmarks: 1,102/1,102 on LongMemEval and 1,882/1,882 on ScriptMem. The comparison is not losing Agent citations through truncation.

## LongMemEval-S results

| Answer evidence surface | Correct | Accuracy |
|---|---:|---:|
| Agent selection package + cited raw | 348/500 | 69.60% |
| All searched raw memories | 316/500 | 63.20% |
| Raw searched memories Top-30 | 318/500 | 63.60% |

Raw-all versus raw Top-30:

```text
raw-all correct, Top-30 wrong: 15
raw-all wrong, Top-30 correct: 17
net: +2 / +0.40 points
McNemar exact p = 0.860
```

Agent package versus raw Top-30:

```text
Agent correct, Top-30 wrong: 63
Agent wrong, Top-30 correct: 33
net Agent advantage: 30 / 6.00 points
McNemar exact p = 0.00288
```

| LongMemEval category | Agent package | Raw all | Raw Top-30 |
|---|---:|---:|---:|
| abstention | 63.33% | 33.33% | 36.67% |
| knowledge update | 76.92% | 75.64% | 76.92% |
| multi-session | 63.16% | 52.63% | 54.89% |
| single-session assistant | 89.29% | 92.86% | 92.86% |
| single-session preference | 26.67% | 43.33% | 33.33% |
| single-session user | 91.43% | 88.57% | 88.57% |
| temporal reasoning | 61.65% | 45.11% | 45.86% |

Top-30 does not solve LongMemEval's raw-context weakness. The Agent package's main advantage is in abstention, multi-session, and temporal reasoning; raw context is better in some single-session categories.

## ScriptMem-v19 results

| Answer evidence surface | Correct | Accuracy |
|---|---:|---:|
| Agent package + cited raw | 301/457 | 65.86% |
| Raw searched memories Top-30 | 321/457 | 70.24% |

Paired transition:

```text
Agent correct, Top-30 wrong: 28
Agent wrong, Top-30 correct: 48
net Top-30 advantage: 20 / 4.38 points
McNemar exact p = 0.0286
```

| ScriptMem group | Agent package | Raw Top-30 |
|---|---:|---:|
| single choice | 77.52% | 81.21% |
| multi-select | 48.39% | 52.42% |
| ordering | 28.57% | 40.00% |
| angry | 65.66% | 69.70% |
| enemy | 65.96% | 70.21% |
| friends | 64.37% | 69.54% |
| man_earth | 68.89% | 72.22% |

Raw Top-30 wins every ScriptMem question type and script. It also exceeds the different-retrieval historical v1 cited-only result of 314/457 (68.71%), although that latter comparison is not paired on the same retrieval contract.

## Conclusion

The corrected result is benchmark-dependent:

- **ScriptMem:** raw Top-30 is significantly better than Agent package plus cited memories.
- **LongMemEval:** Agent package plus cited memories remains significantly better than raw Top-30.
- **PersonaMem:** the separate raw Top-30 experiment also outperforms cited-only, while generated summaries hurt.

There is no valid universal conclusion that Agent products should always accompany memories. The evidence supports a versioned Answer projection and benchmark/task-sensitive component ablations, not wholesale serialization of Agent products.
