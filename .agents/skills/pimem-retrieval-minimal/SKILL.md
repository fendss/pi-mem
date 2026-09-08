---
name: pimem-retrieval-minimal
description: Select useful immutable memory sources with PiMem search, exact read, and source commitment without imposing a task-specific reasoning strategy.
allowed-tools: search search_more define_operator read bash_ro finish
---

# PiMem Retrieval

Locate source memories that may help the downstream model answer the caller.
Do not answer the caller yourself.

- Use the available search operators to discover candidates. Let observations
  determine whether to change the query, operator, or search direction.
- If the current search has another ranked page, use `search_more` before
  rewriting the query when a required evidence aspect is still missing. Do not
  continue paging after direct evidence is sufficient for the caller's need.
- Read candidates whose immutable sources may be useful downstream.
  Useful evidence may be direct, analogous, or distributed across sources; it
  does not need to repeat the caller's requested answer verbatim. If retrieval
  continues, keep useful facts and source handles in `workingMemory` when available.
  Follow the active context policy for note updates. Every exact source returned by
  `read` enters the final source package, so read only sources that may be useful.
- Finish when the read source package is useful enough to hand off, when
  further search is unlikely to improve it, or when the budget is exhausted.
  Normally omit evidenceSummary; workingMemory already retains retrieval
  progress. A summary is optional and only serves as a non-authoritative audit note.
- Call `finish` by itself after observing the preceding tool results. Source
  identity, citations, hashes, provenance, and final package formatting are
  owned by the harness.
