---
name: pimem-retrieval-v6
description: Candidate bounded-coverage retrieval policy. Opt in explicitly; stable production remains on pimem-retrieval v5.
allowed-tools: search read bash_ro finish
---

# PiMem Retrieval

Choose the `search` operator yourself. The harness never routes from question keywords.

- `hybrid`: default broad recall for one entity or fact.
- `lexical`: exact names, titles, labels, numbers, or phrases.
- `coverage`: independent evidence needs, repeated events, lists, summaries, ordering, or cross-session evidence. Put each need or facet in its own query.
- `temporal`: event dates, ordering, or elapsed time. It retrieves semantic seeds and joins source-backed temporal facts.
- `numeric`: explicit quantities, counts, totals, or changing numeric states. It joins typed numeric facts; do not sum targets or cumulative snapshots.
- `history`: preferences, constraints, current state, and updates. It returns user claims chronologically.

Before searching, form a private evidence-demand ledger: one slot for each independently requested fact, event, constraint, comparison, or time anchor. For an open-ended request such as all events or a summary, use distinct entities, themes, sessions, and time segments as provisional slots.

Use bounded adaptive retrieval:

- A single-fact question may finish after one search only when a direct source fully supports it.
- For multiple or open-ended slots, the first search is discovery, not completion. Use `coverage` with separate queries, then run focused follow-up searches for uncovered slots.
- Use at most three search rounds. Stop earlier only when every explicit slot has direct support. For open-ended coverage, stop after a focused round adds no new distinct supported item.
- Do not repeat equivalent queries. Change the missing entity, facet, time segment, exact phrase, or operator.

Search output is navigation. For `coverage` results, inspect the matched query for each candidate and `read` at least one promising direct source for every query or facet before deciding coverage; do not spend the read budget on many candidates for one facet while ignoring others. Read nearby turns when the fact, role, state, or chronology is incomplete. Treat topical similarity, neighboring entities, and generic assistant advice as distractors, not evidence.

Preserve evidence instead of minimizing citations:

- Once a read memory directly establishes a distinct requested item, cite it unless a better cited source replaces it as a duplicate.
- For ordering, cite each event and keep the requested order in `inventory` and citations.
- For updates or contradictions, cite the relevant earlier and later claims separately and preserve their chronology.
- For preferences, use direct user likes, dislikes, comparisons, and constraints. A purchase, trial, or assistant recommendation alone is weak evidence.

Before calling `finish` alone, enforce the evidence-demand ledger:

- Mark `sufficient` only when every explicit slot has direct cited support. Silently identify the exact source sentence that states the required subject, relation, and value; a topically related passage that requires inventing any of them is unsupported.
- For open-ended coverage, inventory every distinct supported item and cite every referenced memory.
- If focused searches return only distractors or leave any explicit slot unsupported, mark `insufficient` rather than guessing, filling from general knowledge, or substituting zero.
- Each citation `supports` states one atomic fact from that cited memory only. Do not combine sources, calculate, or infer in a support string.
- `evidenceSummary` is a lossless compact ledger of cited facts. Keep distinct items, sessions, and updates separate; add no unsupported conclusion.
- Use `count` only when stated by a source or exactly derived from the complete cited inventory.
- Check that status, summary, supports, inventory, count, and cited raw memories agree.

Do not produce the caller's final answer.
