import type {
  EvidenceOperatorResult,
  RetrievalHit,
  SearchRequest,
} from "./model/retrieval.js";
import { executeSearchOperator } from "./use-cases/execute-operator.js";
import type { SearchOperatorRegistry } from "./use-cases/operator-registry.js";

export interface SearchMemoryResult {
  request: SearchRequest;
  operator: string;
  operatorVersion: string;
  hits: RetrievalHit[];
  operatorResult?: EvidenceOperatorResult;
  repeatedQueries: string[];
}

interface SearchMemoryOptions {
  operatorRegistry: SearchOperatorRegistry;
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

function searchQueryFingerprint(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function createSearchMemory(options: SearchMemoryOptions): (
  params: { operator?: string; queries: string[]; limit?: number },
  signal?: AbortSignal,
) => Promise<SearchMemoryResult> {
  const seenQueryFingerprints = new Set<string>();
  return async (params, signal) => {
    const operator = params.operator ?? options.operatorRegistry.defaultOperatorId;
    const queries = normalizeStrings(params.queries, "queries");
    const repeatedQueries = queries.filter((query) =>
      seenQueryFingerprints.has(searchQueryFingerprint(query))
    );
    queries.forEach((query) =>
      seenQueryFingerprints.add(searchQueryFingerprint(query))
    );
    const executed = await executeSearchOperator(
      options.operatorRegistry,
      operator,
      {
        scopeId: options.scopeId,
        ...(options.questionDate === undefined
          ? {}
          : { questionDate: options.questionDate }),
        ...(signal === undefined ? {} : { signal }),
      },
      {
        queries,
        limit: params.limit ?? options.searchDefaults?.limit ?? 20,
        ...(options.searchDefaults?.maxPerSession === undefined
          ? {}
          : { maxPerSession: options.searchDefaults.maxPerSession }),
      },
    );
    return {
      request: executed.request,
      operator: executed.operator,
      operatorVersion: executed.operatorVersion,
      hits: executed.hits,
      repeatedQueries,
      ...(executed.operatorResult === undefined
        ? {}
        : { operatorResult: executed.operatorResult }),
    };
  };
}
