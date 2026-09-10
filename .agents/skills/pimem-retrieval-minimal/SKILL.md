---
name: pimem-retrieval-minimal
description: Find useful immutable source evidence through a compact search, read, and finish interface.
allowed-tools: search search_more read finish
---

# PiMem Retrieval

Find direct source evidence for the caller. Do not answer the question.

- Search for the facts that are still missing. Use distinct focused queries.
- Read only promising candidates from the visible page. Use `search_more` when
  the next page is needed.
- If retrieval continues, keep a short `workingMemory` containing only
  established facts and facts still missing. Do not copy handles, candidate
  lists, search history, or reasoning.
- Finish sufficient only after the exact sources already read cover the
  question. The harness retains sources and prepares the final evidence package.
