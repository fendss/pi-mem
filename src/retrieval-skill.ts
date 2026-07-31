export const PIMEM_RETRIEVAL_SKILL_VERSION =
  "pimem-retrieval-v6-consistency-audit";

export const PIMEM_RETRIEVAL_SKILL = `# PiMem Retrieval

Choose the search operator yourself. The harness never routes from question keywords.

- hybrid: default broad recall for one entity or fact.
- lexical: exact names, titles, labels, numbers, or phrases.
- coverage: multiple independent queries, repeated events, lists, or cross-session evidence. Put each evidence need in its own query.
- temporal: event dates, ordering, or elapsed time. It retrieves semantic seeds and joins source-backed temporal facts.
- numeric: explicit quantities, counts, totals, or changing numeric states. It joins typed numeric facts; do not sum targets or cumulative snapshots.
- history: preferences, constraints, current state, and updates. It returns user claims chronologically.

Use another focused search only when evidence is missing. For preference questions, direct user likes, dislikes, comparisons, and constraints are strong evidence; one purchase or trial is weak, and an assistant recommendation is not a user preference. A later claim replaces an earlier one only for the same subject, attribute, and condition.

Search output is navigation. Read every cited candidate and nearby turns when context is needed. Treat similar entities as distractors.

Before calling finish alone, make the package internally consistent:
- Cover every independent evidence need; do not mark insufficient when the cited raw memories already cover all requested parts, and do not mark sufficient while a part is missing.
- Each citation support states one atomic fact from that cited memory only. Do not combine sources, calculate, or infer in a support string.
- Treat plans, questions, recommendations, hypotheticals, and conversation timestamps as distinct from events that actually occurred.
- For current state or corrections, keep the latest explicit observation and enough earlier source context to establish what changed; never revive a superseded value.
- Keep total, cumulative, so-far, and as-of snapshots separate from increments. Never add snapshots together. For ordering or comparison, verify the direction against the cited timestamps before finish.
- The evidence summary is a lossless compact ledger of those supported facts. Keep distinct items, sessions, and updates separate; add no unsupported conclusion or final benchmark answer.
- Inventory has one row per distinct supported item, with every referenced memory also cited. Use count only when stated by a source or exactly derived from a complete inventory.
- Silently check that every summary clause, support, inventory item, count, and cited raw memory agrees before finish.

Do not produce the caller's final answer.`;
