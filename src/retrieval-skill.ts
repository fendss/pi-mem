export const PIMEM_RETRIEVAL_SKILL_VERSION =
  "pimem-retrieval-v4-agent-directed-search-operators";

export const PIMEM_RETRIEVAL_SKILL = `# PiMem Retrieval Skill

Use the unified search tool as an operator manual. You choose every operator from the evidence need; the harness never infers one from question keywords and never accepts SQL text.

## Evidence contract

Identify the exact entities, requested attributes, question date, and every evidence slot before searching. Preserve source roles, timestamps, exact names, values, and relations. Similar entities are hard negatives. Search previews and structured rows are navigation only; read every cited source memory.

## Search operators

### relevance

Use first for broad semantic and lexical recall. It fuses dense retrieval, full-text retrieval, and candidate-local BM25. Start with one or more focused query variants, limit 20, and maxPerSession 4. Use separate queries for separate entities or relations. Inspect the first result before expanding.

### lexical

Use for exact names, titles, labels, numbers, or phrases, especially when relevance returns semantically similar but wrong entities. The harness constructs safe FTS5 queries; provide ordinary text, not query syntax.

### time_range

Use when source-time bounds are known or can be derived confidently from the question date. Provide after/before and choose chronological order for event chains or reverse-chronological order for latest state. Source timestamp is metadata; it may differ from a date mentioned inside the memory.

### temporal_facts

Use when a memory may express an event date such as an explicit date, yesterday, a prior weekday, or N units ago. Provide ISO dates only when derivable with confidence. This operator searches the deterministic temporal sidecar and returns resolved dates with source candidates. Do not use it as a substitute for reading the source.

### numeric_facts

Use to enumerate explicit numeric occurrences. Filter by unit or value kind when useful. Value kinds are increment, cumulative, snapshot, target, and unknown. Do not sum targets or successive cumulative snapshots. Optional reducers are explicit and deterministic:
- count_distinct counts non-target rows using the requested distinct key;
- sum adds increment rows only and refuses incompatible units;
- latest selects the latest cumulative or snapshot row.
Always inspect and read the included candidate sources before trusting a reduction.

### session_expand

Use after finding a promising candidate when neighboring turns may contain the missing value, reply, date, or relation. Pass withinCandidateRefs and bounded contextBefore/contextAfter. It discovers candidates; read remains the evidence operation.

### session_coverage

Use for multi-session lists, repeated occurrences, and bounded coverage checks. It returns at most one representative hit per session and reports whether the result was truncated. Coverage cannot prove absence when truncated or when the queries do not cover the requested concept.

## Evidence playbooks

For temporal questions, search the event semantically, then use time_range or temporal_facts only if their metadata operation is warranted. Read the required events and explicitly order them.

For counts and lists, search each requested action or item, use session_coverage to inspect cross-session breadth, use numeric_facts only for explicit numbers, then build one source-grounded inventory row per distinct occurrence. A cumulative scalar may support count without fabricated inventory rows.

For current or updated state, keep entity and attribute fixed, search chronological history, and distinguish initial, previous, and current literally. A later state supersedes an earlier one only when the question asks for current state.

For preferences, retrieve direct personal statements and constraints. Distinguish liking or avoiding something from merely mentioning, buying, or receiving a recommendation. Check later statements before claiming a current preference.

## Sufficiency and finish

Use additional focused searches only for uncovered evidence slots. Mark insufficient only after reasonable exact, temporal, numeric, session, or lexical checks; bounded retrieval alone does not prove absence. Call finish alone with concise evidenceSummary and source-grounded citations. Use count only for a supported scalar and inventory only for explicitly supported items. Do not answer the caller's question yourself.`;
