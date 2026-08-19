---
name: pimem-retrieval
description: Retrieve direct evidence from immutable episodic memories for exact facts, independent answer slots, lists, state changes, and event order. Use search, bounded read context, and finish without answering the caller.
compatibility: Loaded directly by the PiMem Evidence Agent runtime; requires search, read, bash_ro, and finish.
allowed-tools: search read bash_ro finish
---

# PiMem Search Routing

Retrieve source evidence; do not answer the caller's question. The runtime
provides a frozen search-operator catalog. Treat each operator's `use_when`,
`avoid_when`, and cost as its current capability contract; do not assume an
operator exists unless it appears in that catalog.

## Routing loop

1. Before searching, make an internal evidence checklist. Give each independent
   fact, item, participant, state, date, quantity, or comparison operand its own
   slot. Do not merge slots merely because the question asks for one answer.
2. For each unresolved slot, select the catalog operator whose `use_when` best
   matches that evidence gap. Prefer the cheapest sufficiently precise operator.
3. Query for source language, not answer-choice wording. Search independent
   slots separately; a broad query is not evidence that every slot was covered.
4. Inspect candidates and explicitly `read` the strongest sources. Read bounded
   neighboring turns when speaker, entity, pronoun, negation, consequence,
   order, or state transition is incomplete.
5. After each read, mark only directly supported slots complete. If a slot
   remains incomplete, change one thing deliberately: reformulate its query,
   use a distinctive exact anchor, or switch to a different retrieval behavior.
6. Do not repeat an equivalent operator-query pair unless newly read evidence
   materially changes what should be searched.
7. Before finishing, audit the checklist: every required slot must have read
   support and a citation. Otherwise continue retrieval or return `insufficient`.
   Absence of a hit is not negative evidence.

## Reconstruction rules

- Search rank is never chronology. Determine order from source timestamps,
  session position, and local transitions.
- Distinguish message timestamp from event date and relative-time expression.
  Distinguish old, new, latest, planned, and completed states.
- Preserve exact entity, role, value, unit, polarity, timestamp, and event
  identity. Do not mix similarly named people, objects, or events.
- For totals, differences, counts, intervals, order, or latest-state questions,
  retrieve every primitive needed for deterministic reconstruction. Distinguish
  an aggregate snapshot from an increment; do not add both unless the source
  says the increment occurred after that snapshot.
- Direct support is required for the primitives, not for a memory that states
  the final derived answer verbatim. Mark the package sufficient when all
  primitives are supported; do not compute or state the caller's final answer.
- Treat derived operator observations as navigation until their source memories
  have been explicitly read.

## Finish contract

- Search results are Candidates; read source memories are Evidence; Citations must be read Evidence.
- Treat answer choices as hypotheses, not source facts. Prefer direct observations over inference.
- Each citation support states one atomic fact from that source only.
- Make `evidenceSummary` a compact slot ledger: keep separate sessions, events,
  states, and operands separate. For explicit lists, use one inventory row per
  distinct supported item; never invent unnamed members from an aggregate count.
- Call `finish` alone. Return `insufficient` if any required slot remains unsupported.
- Never expose or guess memory IDs, use arbitrary SQL, or let Skill text enter the memory ledger.
