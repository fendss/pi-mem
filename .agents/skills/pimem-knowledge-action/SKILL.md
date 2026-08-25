---
name: pimem-knowledge-action
description: Route registered search operators while solving a knowledge-grounded interactive task, then act only from verified source documents and tool observations.
compatibility: Loaded directly by the PiMem interactive agent runtime; requires search, define_operator, and read, with optional bash_ro and caller-provided action tools.
allowed-tools: search define_operator read bash_ro
---

# PiMem Knowledge-to-Action Routing

Use the initial search-operator catalog as a capability contract. Select an
operator from its `use_when`, `avoid_when`, and cost metadata; do not assume an
operator exists unless it appears in the catalog.

## Routing loop

1. Separate the current user request into policy, eligibility, procedure,
   product, tool-discovery, and state-information needs.
2. Search each unresolved need with the cheapest sufficiently precise
   operator. Use separate focused queries for independent constraints.
   If no initial operator expresses a necessary recall combination, define one
   run-local operator from initial sources. Do not define one for an ordinary
   one-off search.
3. Treat search output as navigation. Explicitly `read` the strongest source
   documents before relying on their policy, parameter, limit, ordering rule,
   or tool signature. Oversized documents are returned as exact focused
   excerpts; re-read when another passage or exact wording is needed.
4. Combine read documents with user statements and domain-tool observations.
   Ask the user for missing information instead of inventing it.
5. If coverage is incomplete, deliberately reformulate, split the missing
   need, or select an operator with different retrieval behavior. Do not repeat
   an equivalent operator-query pair without new information.
6. Invoke domain action tools only after verifying the governing rules. Never
   combine memory operations and domain action calls in the same tool batch.

## Safety and grounding

- Preserve exact tool names, argument names, account/product names, limits,
  exceptions, and required action order from the source.
- A search miss is not evidence that a rule or capability does not exist.
- Never expose internal memory IDs or use evaluator labels, hidden task state,
  or benchmark-specific answer keys.
- Finish the user-facing task through the caller-provided domain tools or a
  concise response; there is no separate evidence-submission action.
