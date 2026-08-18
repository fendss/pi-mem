import type { MemoryRecord } from "../../../memory/index.js";
import { buildAggregateOperatorResult } from "../../operators/numeric-operator.js";
import { buildTimelineOperatorResult } from "../../operators/temporal-operator.js";
import type {
  EvidenceOperatorSearchContext,
  RetrievalHit,
  SearchOrder,
  SearchRequest,
} from "../../model/retrieval.js";
import type { SearchOperatorInput } from "../../model/search-operator.js";
import type { SearchOperatorStore } from "../../ports/memory-tool-store.js";
import type { SearchOperator } from "../../ports/search-operator.js";

const VERSION = "1";

function makeSearchRequest(
  input: SearchOperatorInput,
  overrides: {
    limit?: number;
    roles?: MemoryRecord["role"][];
    order?: SearchOrder;
  } = {},
): SearchRequest {
  return {
    queries: [...input.queries],
    limit: overrides.limit ?? input.limit,
    order: overrides.order ?? "relevance",
    ...(overrides.roles === undefined ? {} : { roles: overrides.roles }),
    ...(input.maxPerSession === undefined
      ? {}
      : { maxPerSession: input.maxPerSession }),
  };
}

function mergeOperatorHits(
  preferred: readonly RetrievalHit[],
  fallback: readonly RetrievalHit[],
  limit: number,
): RetrievalHit[] {
  const merged = new Map<string, RetrievalHit>();
  for (const hit of [...preferred, ...fallback]) {
    if (!merged.has(hit.record.memoryId)) merged.set(hit.record.memoryId, hit);
    if (merged.size >= limit) break;
  }
  return [...merged.values()];
}

async function coverageHits(
  store: SearchOperatorStore,
  scopeId: string,
  input: SearchOperatorInput,
  signal?: AbortSignal,
): Promise<RetrievalHit[]> {
  const grouped = new Map<string, {
    hits: RetrievalHit[];
    queries: Set<string>;
    score: number;
  }>();
  for (const query of input.queries) {
    const hits = await store.search(scopeId, {
      queries: [query],
      limit: Math.min(100, Math.max(20, input.limit * 2)),
      order: "relevance",
      ...(input.maxPerSession === undefined
        ? {}
        : { maxPerSession: input.maxPerSession }),
    }, signal);
    for (const hit of hits) {
      const entry = grouped.get(hit.record.sessionId) ?? {
        hits: [],
        queries: new Set<string>(),
        score: 0,
      };
      entry.hits.push(hit);
      entry.queries.add(query);
      entry.score += 1 / (60 + hit.rank);
      grouped.set(hit.record.sessionId, entry);
    }
  }
  const orderedSessions = [...grouped.entries()].sort((left, right) =>
    right[1].queries.size - left[1].queries.size ||
    right[1].score - left[1].score ||
    left[0].localeCompare(right[0])
  );
  const selected = new Map<string, RetrievalHit>();
  for (const [, session] of orderedSessions) {
    let sessionCount = 0;
    for (const hit of session.hits.sort((left, right) =>
      left.rank - right.rank || left.record.turnIndex - right.record.turnIndex
    )) {
      if (selected.has(hit.record.memoryId)) continue;
      selected.set(hit.record.memoryId, hit);
      sessionCount += 1;
      if (selected.size >= input.limit) return [...selected.values()];
      if (
        input.maxPerSession !== undefined &&
        sessionCount >= input.maxPerSession
      ) break;
    }
  }
  return [...selected.values()];
}

function hybridOperator(store: SearchOperatorStore): SearchOperator {
  return {
    id: "hybrid",
    version: VERSION,
    guide: {
      summary: "Broad semantic and lexical recall when source wording is uncertain.",
      useWhen: ["The fact is known but its exact wording is uncertain."],
      avoidWhen: ["A rare exact name, quotation, identifier, or number is already known."],
      cost: "medium",
    },
    async execute(context, input) {
      const request = makeSearchRequest(input);
      return {
        request,
        hits: await store.search(context.scopeId, request, context.signal),
      };
    },
  };
}

function lexicalOperator(store: SearchOperatorStore): SearchOperator {
  return {
    id: "lexical",
    version: VERSION,
    guide: {
      summary: "Exact text search for names, labels, quotations, numbers, and actions.",
      useWhen: ["The query contains a distinctive exact textual anchor."],
      avoidWhen: ["The source is likely paraphrased or uses unknown wording."],
      cost: "low",
    },
    async execute(context, input) {
      const request = makeSearchRequest(input);
      return {
        request,
        hits: store.searchLexical === undefined
          ? await store.search(context.scopeId, request, context.signal)
          : await store.searchLexical(context.scopeId, request, context.signal),
      };
    },
  };
}

function coverageOperator(store: SearchOperatorStore): SearchOperator {
  return {
    id: "coverage",
    version: VERSION,
    guide: {
      summary: "Search independent evidence needs and merge unique memories across sessions.",
      useWhen: ["The question contains multiple items, alternatives, stages, or participants."],
      avoidWhen: ["Only one atomic fact is required."],
      cost: "high",
    },
    async execute(context, input) {
      const expandedInput = { ...input, limit: Math.max(40, input.limit) };
      return {
        request: makeSearchRequest(expandedInput),
        hits: await coverageHits(
          store,
          context.scopeId,
          expandedInput,
          context.signal,
        ),
      };
    },
  };
}

function historyOperator(store: SearchOperatorStore): SearchOperator {
  return {
    id: "history",
    version: VERSION,
    guide: {
      summary: "Return user claims chronologically for preferences, constraints, and updates.",
      useWhen: ["The requested answer depends on user history or the latest stated state."],
      avoidWhen: ["Chronology and source role do not matter."],
      cost: "medium",
    },
    async execute(context, input) {
      const request = makeSearchRequest(
        { ...input, limit: Math.max(40, input.limit) },
        { roles: ["user"], order: "chronological" },
      );
      return {
        request,
        hits: await store.search(context.scopeId, request, context.signal),
      };
    },
  };
}

function evidenceOperator(
  store: SearchOperatorStore,
  operator: "temporal" | "numeric",
): SearchOperator {
  const temporal = operator === "temporal";
  return {
    id: operator,
    version: VERSION,
    guide: temporal
      ? {
          summary: "Find and organize date facts, intervals, and time windows.",
          useWhen: ["The answer depends on event dates, relative time, or temporal order."],
          avoidWhen: ["No temporal relation needs reconstruction."],
          cost: "high",
        }
      : {
          summary: "Find explicit quantities and organize changing numeric states.",
          useWhen: ["The answer depends on quantities, totals, targets, or numeric updates."],
          avoidWhen: ["Numbers are incidental rather than evidence-bearing."],
          cost: "high",
        },
    async execute(context, input) {
      const request = makeSearchRequest(input);
      const primaryHits = await store.search(
        context.scopeId,
        request,
        context.signal,
      );
      const maxCandidates = temporal ? 60 : 80;
      const expansionContext: EvidenceOperatorSearchContext = {
        operator,
        maxCandidates,
      };
      const databaseHits = store.expandEvidenceOperator === undefined
        ? []
        : await store.expandEvidenceOperator(
            context.scopeId,
            request,
            expansionContext,
            primaryHits,
          );
      const hits = databaseHits.length === 0
        ? primaryHits
        : mergeOperatorHits(databaseHits, primaryHits, maxCandidates);
      return {
        request,
        hits,
        operatorResult: temporal
          ? buildTimelineOperatorResult(
              databaseHits.length === 0 ? primaryHits : databaseHits,
              request.queries.join(" "),
              context.questionDate,
            )
          : buildAggregateOperatorResult(databaseHits),
      };
    },
  };
}

export function builtInSearchOperators(
  store: SearchOperatorStore,
): SearchOperator[] {
  return [
    hybridOperator(store),
    lexicalOperator(store),
    coverageOperator(store),
    evidenceOperator(store, "temporal"),
    evidenceOperator(store, "numeric"),
    historyOperator(store),
  ];
}
