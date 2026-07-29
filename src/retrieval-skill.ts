export const PIMEM_RETRIEVAL_SKILL_VERSION = "pimem-retrieval-v3.17-evidence-first-presentation";

export const PIMEM_RETRIEVAL_SKILL = `# PiMem Retrieval Skill

Follow this workflow for every memory question.

## 1. Parse the evidence contract

Identify the target entities, requested attribute, question date, evidence slots, and operators such as current, initial, previous, before, after, total, all, or how long. Split count, list, comparison, and total questions into required subclaims before searching.

## 2. Search flexibly by observing before expanding

A strong starting point is one direct query based on the cleaned question, with limit 20, maxPerSession 4, and both user and assistant turns. Inspect what that result covers before deciding how to continue. The harness may highlight question-shaped evidence concerns such as temporal, update, aggregate, comparison, or preference coverage; these direct attention rather than impose a fixed procedure. Use multiple queries together, different limits, filters, ordering, or any number of additional searches whenever the evidence shape makes them useful.

Keep additional searches semantically focused. Expand around a meaningful uncovered entity, attribute, event, date, state, occurrence, relation, or personal anchor instead of accumulating generic synonym variants. For multi-entity questions, separate queries can help cover each side without diluting the relation.

Inspect source roles and prefer direct personal statements. Use chronological output for temporal event sequences and state updates, and reverse chronology when latest or current state is the focus. If a relevant preview may omit an adjacent value, date, question, reply, or relation, read enough neighboring turns to recover it.

Pay attention to the evidence type: recover every event and date needed for temporal reasoning; reconstruct the same entity and attribute across updates; distinguish aggregate totals from distinct occurrences; retrieve direct personal constraints for preference questions; and treat similar entities as hard negatives.

Search previews are ephemeral navigation, not evidence. Read the exact memories needed to support the evidence package. The caller will preserve every candidate while presenting cited memories first, then other read evidence, then unread candidates; careful evidence selection therefore supplies an attention signal without changing provenance. Old search and bash outputs expire from active context, while the full audit trace remains preserved.

## 3. Build typed evidence

For each selected fact, track claim, exact entity, value, session timestamp, and memory ID. Never transfer a value between similar entities. Camera does not support film; iPhone does not support iPad; one doctor or location does not support another.

For count and list questions, inspect every candidate that may describe a distinct requested item or action, then create one evidence-ledger row per required item or occurrence, bind each row to source memory, and deduplicate. If the question joins actions with "or", count distinct action-item obligations; a return and a pickup remain separate obligations even when they involve exchanged versions of one product. Do not confuse a nearby number such as team size with the requested item count. A cumulative scalar count such as "tried four restaurants so far" may be recorded as count evidence without fabricating four unnamed inventory rows. Never sum successive cumulative totals for the same metric; a later "so far" total supersedes an earlier total. If no source gives an explicit total and search coverage remains open, a focused bash_ro keyword scan can help discover omitted evidence before finishing. If any required component is unsupported, do not treat it as zero.

For temporal questions, organize a timeline in the evidence summary: event, source timestamp, normalized relative date, and requested operation. Sort explicitly and preserve the source facts needed by the benchmark answerer.

For update questions, reconstruct the ordered state chain for the same entity and attribute. Apply current, initial, previous, before, and after literally. A later explicit state supersedes an earlier one only for current-state questions. A later phrase such as "my personal best is X" states the active record even when it appears inside a future goal to beat X; label that supersession explicitly in the evidence summary.

For preference questions, extract liked and disliked constraints as evidence. Cite direct preference statements only; generic recommendation lists are distractors unless the question specifically asks what was previously recommended.

## 4. Verify sufficiency and distractors

Before finishing, check that every target entity and required evidence slot is supported. Treat near-entity memories as hard negatives, not evidence. Mark the package insufficient only after focused searches for the exact entity and attribute. Do not guess or synthesize the benchmark answer.

## 5. Finish with evidence

Read every cited memory. Call finish alone with status, a compact evidence summary, and evidence-grounded citations. Use count only for a source-grounded aggregate. Use inventory only for an explicitly enumerated supported list. The memory agent stops at this evidence package; benchmark-specific answer formatting belongs to the caller.`;
