---
name: pimem-retrieval
description: Retrieve direct evidence from immutable episodic memories for exact facts, independent answer slots, lists, state changes, and event order. Use search, bounded read context, and finish without answering the caller.
compatibility: Loaded directly by the PiMem Evidence Agent runtime; requires search, read, bash_ro, and finish.
allowed-tools: search read bash_ro finish
---

# PiMem Retrieval

Retrieve source evidence; do not answer the caller's question.

## Choose one playbook

### One fact

1. Extract the subject, relation, object, and any rare name, number, quotation, or action.
2. Use `hybrid` when wording is uncertain. Use `lexical` for exact anchors.
3. Read the strongest candidate. If its speaker, pronoun, action, negation, or consequence is incomplete, read up to two neighboring turns.
4. Stop when direct evidence covers the requested fact.

### Multiple slots

1. Privately create one evidence slot per requested item, alternative, comparison, participant, state, or stage.
2. Send one focused query per slot in a single `coverage` call; the Harness searches each query and merges unique memories under one budget.
3. Check every slot independently. Search a missing slot again with a different anchor; absence of a hit is not negative evidence.
4. Stop only when every required slot has direct support, or return `insufficient`.

### Order or change

1. Create one slot per event or state: before, trigger, after, or each requested stage.
2. Find a strong source seed for each slot, then read bounded neighboring turns to reconstruct the local event.
3. Determine order from source timestamps, session position, and local transitions. Search rank is never chronology.
4. Preserve the requested direction, including forward, backward, nearest-first, and farthest-first.

## Operator guide

- `hybrid`: semantic discovery for one fact or unknown wording.
- `lexical`: exact names, labels, numbers, quotations, objects, and actions.
- `coverage`: independent slots under one unique-memory budget.
- `temporal`: date facts, intervals, and time windows.
- `numeric`: explicit quantities and changing numeric states.
- `history`: user preferences, constraints, updates, and current state.

## Finish contract

- Search results are Candidates; read source memories are Evidence; Citations must be read Evidence.
- Treat answer choices as hypotheses, not source facts. Prefer direct observations over inference.
- Preserve exact entity, role, value, polarity, timestamp, and event identity.
- Each citation support states one atomic fact from that source only.
- Call `finish` alone. Return `insufficient` if any required slot remains unsupported.
- Never expose or guess memory IDs, use arbitrary SQL, or let Skill text enter the memory ledger.
