import { buildAggregateOperatorResult } from "./operators/numeric-operator.js";
import { buildTimelineOperatorResult } from "./operators/temporal-operator.js";
import type { RetrievalHit } from "./model/retrieval.js";
import type { MemoryRecord } from "../memory/index.js";
import type {
  EvidenceOperatorResult,
  EvidenceOperatorSearchContext,
  SearchOperator,
  SearchOrder,
  SearchRequest,
} from "./model/retrieval.js";

export interface MemoryToolStore {
  search(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): RetrievalHit[] | Promise<RetrievalHit[]>;
  searchLexical?(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): RetrievalHit[] | Promise<RetrievalHit[]>;
  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore?: number,
    contextAfter?: number,
  ): MemoryRecord[];
  expandEvidenceOperator?(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly RetrievalHit[],
  ): RetrievalHit[] | Promise<RetrievalHit[]>;
}

export interface SearchMemoryResult {
  request: SearchRequest;
  operator: SearchOperator;
  hits: RetrievalHit[];
  operatorResult?: EvidenceOperatorResult;
  repeatedQueries: string[];
}

interface SearchMemoryOptions {
  store: MemoryToolStore;
  scopeId: string;
  questionDate?: string;
  searchDefaults?: Pick<SearchRequest, "limit" | "order" | "maxPerSession">;
}

function normalizeStrings(values: readonly string[], label: string): string[] {
  const normalized = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) {
    throw new Error(`${label} must contain at least one non-empty value`);
  }
  return normalized;
}

function makeSearchRequest(
  params: {
    queries: string[];
    limit?: number;
    sessionIds?: string[];
    roles?: MemoryRecord["role"][];
    after?: string;
    before?: string;
    order?: SearchOrder;
    maxPerSession?: number;
  },
  defaults: Pick<SearchRequest, "limit" | "order" | "maxPerSession"> = {},
): SearchRequest {
  const request: SearchRequest = {
    queries: normalizeStrings(params.queries, "queries"),
    limit: params.limit ?? defaults.limit ?? 8,
    order: params.order ?? defaults.order ?? "relevance",
  };
  if (params.sessionIds !== undefined) {
    request.sessionIds = normalizeStrings(params.sessionIds, "sessionIds");
  }
  if (params.roles !== undefined) request.roles = [...new Set(params.roles)];
  if (params.after !== undefined) request.after = params.after.trim();
  if (params.before !== undefined) request.before = params.before.trim();
  const maxPerSession = params.maxPerSession ?? defaults.maxPerSession;
  if (maxPerSession !== undefined) request.maxPerSession = maxPerSession;
  return request;
}

function searchQueryFingerprint(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
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
  store: MemoryToolStore,
  scopeId: string,
  queries: readonly string[],
  limit: number,
  signal?: AbortSignal,
): Promise<RetrievalHit[]> {
  const grouped = new Map<string, {
    hits: RetrievalHit[];
    queries: Set<string>;
    score: number;
  }>();
  for (const query of queries) {
    const hits = await store.search(scopeId, {
      queries: [query],
      limit: Math.min(100, Math.max(20, limit * 2)),
      order: "relevance",
      maxPerSession: 4,
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
      if (selected.size >= limit) return [...selected.values()];
      if (sessionCount >= 4) break;
    }
  }
  return [...selected.values()];
}

export function createSearchMemory(options: SearchMemoryOptions): (
  params: { operator?: SearchOperator; queries: string[]; limit?: number },
  signal?: AbortSignal,
) => Promise<SearchMemoryResult> {
  const seenQueryFingerprints = new Set<string>();
  return async (params, signal) => {
    const operator: SearchOperator = params.operator ?? "hybrid";
    const limit = params.limit ?? options.searchDefaults?.limit ?? 20;
    let request = makeSearchRequest({
      queries: params.queries,
      limit,
      order: "relevance",
      maxPerSession: 4,
    });
    const repeatedQueries = request.queries.filter((query) =>
      seenQueryFingerprints.has(searchQueryFingerprint(query))
    );
    request.queries.forEach((query) =>
      seenQueryFingerprints.add(searchQueryFingerprint(query))
    );

    let hits: RetrievalHit[];
    let operatorResult: EvidenceOperatorResult | undefined;
    if (operator === "lexical") {
      hits = options.store.searchLexical === undefined
        ? await options.store.search(options.scopeId, request, signal)
        : await options.store.searchLexical(options.scopeId, request, signal);
    } else if (operator === "coverage") {
      request = makeSearchRequest({
        queries: request.queries,
        limit: Math.max(40, limit),
        order: "relevance",
        maxPerSession: 4,
      });
      hits = await coverageHits(
        options.store,
        options.scopeId,
        request.queries,
        request.limit ?? 40,
        signal,
      );
    } else if (operator === "history") {
      request = makeSearchRequest({
        queries: request.queries,
        limit: Math.max(40, limit),
        roles: ["user"],
        order: "chronological",
        maxPerSession: 4,
      });
      hits = await options.store.search(options.scopeId, request, signal);
    } else if (operator === "temporal" || operator === "numeric") {
      const primaryHits = await options.store.search(options.scopeId, request, signal);
      const maxCandidates = operator === "temporal" ? 60 : 80;
      const context: EvidenceOperatorSearchContext = {
        operator,
        maxCandidates,
      };
      const databaseHits = options.store.expandEvidenceOperator === undefined
        ? []
        : await options.store.expandEvidenceOperator(
            options.scopeId,
            request,
            context,
            primaryHits,
          );
      hits = databaseHits.length === 0
        ? primaryHits
        : mergeOperatorHits(databaseHits, primaryHits, maxCandidates);
      operatorResult = operator === "temporal"
        ? buildTimelineOperatorResult(
            databaseHits.length === 0 ? primaryHits : databaseHits,
            request.queries.join(" "),
            options.questionDate,
          )
        : buildAggregateOperatorResult(databaseHits);
    } else {
      hits = await options.store.search(options.scopeId, request, signal);
    }

    return {
      request,
      operator,
      hits,
      repeatedQueries,
      ...(operatorResult === undefined ? {} : { operatorResult }),
    };
  };
}
