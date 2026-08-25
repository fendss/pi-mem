---
name: pimem-retrieval
description: Retrieve direct evidence from immutable episodic memories for exact facts, independent answer slots, lists, state changes, and event order. Use search, bounded read context, and finish without answering the caller.
compatibility: Loaded directly by the PiMem Evidence Agent runtime; requires search, define_operator, read, bash_ro, and finish.
allowed-tools: search define_operator read bash_ro finish
---

# PiMem Search Routing

Retrieve source evidence; do not answer the caller's question. The runtime
provides an initial search-operator catalog. Treat each operator's `use_when`,
`avoid_when`, and cost as its current capability contract; do not assume an
operator exists unless it appears in that catalog.

## Routing loop

1. Decompose the question into independent evidence needs: facts, items,
   participants, states, stages, dates, or quantities.
2. For each unresolved need, select the catalog operator whose `use_when` best
   matches the current evidence gap. Prefer the cheapest sufficiently precise
   operator.
   If no existing operator can express a necessary combination, define one
   run-local operator from existing search operators and `union` or `rrf`.
   Prefer the initial catalog and do not define an operator for one ordinary
   search call.
3. Query for source language, not answer-choice wording. Use separate focused
   queries for independent needs.
4. Inspect candidates and explicitly `read` the strongest sources. Read bounded
   neighboring turns when speaker, pronoun, negation, consequence, order, or
   state transition is incomplete. Oversized memories are returned as exact,
   query-focused excerpts. Re-read a candidate if another passage or exact
   wording is still needed.
5. If evidence remains incomplete, change one thing deliberately: reformulate
   the query, search the missing need separately, or switch to an operator with
   different retrieval behavior.
6. Do not repeat an equivalent operator-query pair unless newly read evidence
   materially changes what should be searched.
7. Stop only when every required need has direct read support. Otherwise return
   `insufficient`; absence of a hit is not negative evidence.

## Reconstruction rules

- Search rank is never chronology. Determine order from source timestamps,
  session position, and local transitions.
- Preserve exact entity, role, value, polarity, timestamp, and event identity.
- Treat derived operator observations as navigation until their source memories
  have been explicitly read.

## Finish contract

- Search results are Candidates; bounded exact source reads are Evidence; Citations must be read Evidence.
- Treat answer choices as hypotheses, not source facts. Prefer direct observations over inference.
- Each citation support states one atomic fact from that source only.
- Call `finish` alone. Return `insufficient` if any required slot remains unsupported.
- Never expose or guess memory IDs, use arbitrary SQL, or let Skill text enter the memory ledger.
