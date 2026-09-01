import type { Embedder } from "../model/embedder.js";
import { embeddingProfile } from "../index-scope-embeddings.js";
import { reciprocalRankFusion } from "../ranking.js";
import { finalizeSearchHits } from "../finalize-search-hits.js";
import type {
  EvidenceOperatorSearchContext,
  RetrievalHit,
  RetrievalMetadataFilter,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchRequest,
} from "../model/retrieval.js";
import type {
  EmbeddingIndexStore,
  StoredEmbeddingRecord,
} from "../model/embedding.js";
import type { MemoryRecord } from "../../memory/index.js";
import { queryCenteredEpisodicPreview } from "../../util.js";
import { explicitQueryDateFilter } from "../structured-query-constraints.js";

interface RankedHybridHit extends RetrievalHit {
  denseRank: number;
  lexicalRank: number;
  queryIndex: number;
}

interface AggregatedHybridHit {
  hit: RankedHybridHit;
  bestScore: number;
  totalScore: number;
  queryIndexes: Set<number>;
}

const MULTI_QUERY_COVERAGE_WEIGHT = 0.25;
const MAX_METADATA_ROUTE_RESERVATIONS = 4;
const MAX_QUERY_COVERAGE_RESERVATIONS = 10;
const QUERY_LOCAL_RESERVOIR_LIMIT = 100;

function metadataFilterKey(filter: RetrievalMetadataFilter): string {
  return JSON.stringify([
    filter.source,
    filter.query,
    filter.after,
    filter.before,
  ]);
}

function mergeMetadataFilters(
  ...groups: Array<readonly RetrievalMetadataFilter[] | undefined>
): RetrievalMetadataFilter[] | undefined {
  const merged = new Map<string, RetrievalMetadataFilter>();
  for (const filter of groups.flatMap((group) => group ?? [])) {
    merged.set(metadataFilterKey(filter), filter);
  }
  return merged.size === 0 ? undefined : [...merged.values()];
}

function reserveMetadataRoutes<T extends RetrievalHit>(
  rankings: readonly (readonly T[])[],
): T[] {
  const reserved: T[] = [];
  const seen = new Set<string>();
  for (let depth = 0; reserved.length < MAX_METADATA_ROUTE_RESERVATIONS; depth += 1) {
    let progressed = false;
    for (const ranking of rankings) {
      const hit = ranking[depth];
      if (hit === undefined || seen.has(hit.record.memoryId)) continue;
      reserved.push(hit);
      seen.add(hit.record.memoryId);
      progressed = true;
      if (reserved.length >= MAX_METADATA_ROUTE_RESERVATIONS) break;
    }
    if (!progressed) break;
  }
  return reserved;
}

function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length) {
    throw new Error("Cosine vectors must have the same dimensions");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Cosine vectors must contain only finite values");
    }
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function compareFinal(left: RankedHybridHit, right: RankedHybridHit): number {
  const score = right.score - left.score;
  if (score !== 0) return score;
  const denseRank = left.denseRank - right.denseRank;
  if (denseRank !== 0) return denseRank;
  const lexicalRank = left.lexicalRank - right.lexicalRank;
  if (lexicalRank !== 0) return lexicalRank;
  return left.record.memoryId.localeCompare(right.record.memoryId);
}

export interface HybridSearchStore extends EmbeddingIndexStore {
  search(scopeId: string, request: SearchRequest): RetrievalHit[];
  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly RetrievalHit[],
  ): RetrievalHit[];
  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore?: number,
    contextAfter?: number,
  ): MemoryRecord[];
  getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[];
  findMentionedMemoryIds(scopeId: string, text: string): string[];
}

export class HybridMemoryStore {
  readonly rawStore: HybridSearchStore;
  readonly embedder: Embedder;

  private denseCandidateCount = 0;
  private rerankCandidateCount = 0;

  constructor(rawStore: HybridSearchStore, embedder: Embedder) {
    this.rawStore = rawStore;
    this.embedder = embedder;
  }

  getRetrievalMetadata(): RetrievalMetadata {
    return {
      retrievalProfile: "pimem-hybrid",
      embeddingProfileId: this.embedder.profileId,
      embeddingModel: this.embedder.model,
      embeddingDimensions: this.embedder.dimensions,
    };
  }

  snapshotRetrievalMetrics(): RetrievalMetricsSnapshot {
    const embedding = this.embedder.snapshotMetrics();
    return {
      embeddingCalls: embedding.calls,
      embeddingLatencyMs: embedding.latencyMs,
      denseCandidateCount: this.denseCandidateCount,
      rerankCandidateCount: this.rerankCandidateCount,
    };
  }

  async search(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalHit[]> {
    const profile = embeddingProfile(this.embedder);
    const status = this.rawStore.getEmbeddingIndexStatus(scopeId, profile);
    if (status.total === 0) {
      return [];
    }
    if (status.missing !== 0) {
      throw new Error(
        `Hybrid embedding index is incomplete for scope ${scopeId}: ` +
          `${status.indexed}/${status.total} indexed`,
      );
    }

    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const queryVectors =
      signal === undefined
        ? await this.embedder.embedQueries(request.queries)
        : await this.embedder.embedQueries(request.queries, { signal });
    if (queryVectors.length !== request.queries.length) {
      throw new Error("Query embedding count does not match query count");
    }
    const embeddingFilters = {
      ...(request.sessionIds === undefined
        ? {}
        : { sessionIds: request.sessionIds }),
      ...(request.roles === undefined ? {} : { roles: request.roles }),
      ...(request.after === undefined ? {} : { after: request.after }),
      ...(request.before === undefined ? {} : { before: request.before }),
    };
    const records = this.rawStore.listStoredEmbeddings(
      scopeId,
      profile,
      embeddingFilters,
    );
    if (records.length === 0) return [];

    // Physical ranking must not depend on the visible page size: otherwise a
    // continuation reorders candidates that were already shown.
    const headroom = QUERY_LOCAL_RESERVOIR_LIMIT;
    // Query-local discovery is intentionally wider than the visible result.
    // Selection and observation remain bounded by the request limit below.
    const perQueryLimit = headroom;
    const merged = new Map<string, AggregatedHybridHit>();
    const queryRankings: RankedHybridHit[][] = [];
    const metadataRouteRankings: RankedHybridHit[][] = [];
    request.queries.forEach((query, queryIndex) => {
      const queryVector = queryVectors[queryIndex]!;
      const {
        maxPerSession: _ignoredMaxPerSession,
        order: _ignoredOrder,
        ...lexicalBase
      } = request;
      const rankRoute = (
        routeRecords: readonly StoredEmbeddingRecord[],
        routeRequest: SearchRequest,
        metadataFilter?: RetrievalMetadataFilter,
      ): RankedHybridHit[] => {
        const denseCandidates = routeRecords
          .map((candidate) => ({
            candidate,
            cosine: cosineSimilarity(queryVector, candidate.vector),
          }))
          .sort((left, right) => {
            const score = right.cosine - left.cosine;
            return score !== 0
              ? score
              : left.candidate.record.memoryId.localeCompare(
                  right.candidate.record.memoryId,
                );
          })
          .slice(0, headroom);
        const lexicalHits = this.rawStore.search(scopeId, routeRequest);
        this.denseCandidateCount += denseCandidates.length;

        const union = new Map<string, Pick<StoredEmbeddingRecord, "record">>();
        for (const { candidate } of denseCandidates) {
          union.set(candidate.record.memoryId, candidate);
        }
        for (const hit of lexicalHits) {
          if (!union.has(hit.record.memoryId)) {
            union.set(hit.record.memoryId, { record: hit.record });
          }
        }
        const candidates = [...union.values()];
        this.rerankCandidateCount += candidates.length;
        const indexes = new Map(
          candidates.map((candidate, index) => [candidate.record.memoryId, index]),
        );
        const denseRanking = denseCandidates.map(({ candidate }) =>
          indexes.get(candidate.record.memoryId)!
        );
        const lexicalRanking = lexicalHits.map((hit) =>
          indexes.get(hit.record.memoryId)!
        );
        const fused = reciprocalRankFusion(
          [denseRanking, lexicalRanking],
          60,
          candidates.length,
        );
        const denseRanks = new Map(
          denseRanking.map((candidateIndex, index) => [candidateIndex, index + 1]),
        );
        const lexicalRanks = new Map(
          lexicalRanking.map((candidateIndex, index) => [candidateIndex, index + 1]),
        );
        return candidates
          .map((candidate, index) => ({
            record: candidate.record,
            query,
            retriever: "pimem-hybrid" as const,
            rank: 0,
            score: fused[index]!,
            preview: queryCenteredEpisodicPreview(candidate.record.content, query),
            denseRank: denseRanks.get(index) ?? Number.MAX_SAFE_INTEGER,
            lexicalRank: lexicalRanks.get(index) ?? Number.MAX_SAFE_INTEGER,
            queryIndex,
            ...(metadataFilter === undefined
              ? {}
              : { matchedMetadataFilters: [metadataFilter] }),
          }))
          .sort(compareFinal)
          .slice(0, headroom)
          .map((hit, index) => ({ ...hit, rank: index + 1 }));
      };

      const baseRanking = rankRoute(records, {
        ...lexicalBase,
        queries: [query],
        limit: Math.min(100, headroom),
        order: "relevance",
      });
      const dateFilter = request.after === undefined && request.before === undefined
        ? explicitQueryDateFilter(query)
        : undefined;
      const dateRanking = dateFilter === undefined
        ? undefined
        : rankRoute(
            this.rawStore.listStoredEmbeddings(scopeId, profile, {
              ...embeddingFilters,
              after: dateFilter.after,
              before: dateFilter.before,
            }),
            {
              ...lexicalBase,
              queries: [query],
              limit: Math.min(100, headroom),
              order: "relevance",
              after: dateFilter.after,
              before: dateFilter.before,
            },
            dateFilter,
          );
      if (dateRanking !== undefined && dateRanking.length > 0) {
        metadataRouteRankings.push(dateRanking);
      }
      // The constrained route only receives explicit reservation slots below.
      // Base scores and ordering remain byte-for-byte independent of it.
      const queryHits = baseRanking.slice(0, perQueryLimit);

      queryRankings.push(queryHits);
      for (const hit of queryHits) {
        const existing = merged.get(hit.record.memoryId);
        if (existing === undefined) {
          merged.set(hit.record.memoryId, {
            hit,
            bestScore: hit.score,
            totalScore: hit.score,
            queryIndexes: new Set([queryIndex]),
          });
          continue;
        }
        if (!existing.queryIndexes.has(queryIndex)) {
          existing.queryIndexes.add(queryIndex);
          existing.totalScore += hit.score;
        }
        const filters = mergeMetadataFilters(
          existing.hit.matchedMetadataFilters,
          hit.matchedMetadataFilters,
        );
        if (
          hit.score > existing.bestScore ||
          (hit.score === existing.bestScore &&
            hit.denseRank < existing.hit.denseRank) ||
          (hit.score === existing.bestScore &&
            hit.denseRank === existing.hit.denseRank &&
            hit.lexicalRank < existing.hit.lexicalRank)
        ) {
          existing.hit = {
            ...hit,
            ...(filters === undefined ? {} : { matchedMetadataFilters: filters }),
          };
          existing.bestScore = hit.score;
        } else if (filters !== undefined) {
          existing.hit = {
            ...existing.hit,
            matchedMetadataFilters: filters,
          };
        }
      }
    });

    const aggregated = [...merged.values()]
      .map((entry) => ({
        ...entry.hit,
        matchedQueries: [...entry.queryIndexes]
          .sort((left, right) => left - right)
          .map((queryIndex) => request.queries[queryIndex]!),
        score:
          entry.bestScore +
          MULTI_QUERY_COVERAGE_WEIGHT * (entry.totalScore - entry.bestScore),
      }))
      .sort(compareFinal);
    const reservedCoverage: RankedHybridHit[] = [];
    if (request.queries.length > 1) {
      const reservationLimit = Math.min(
        MAX_QUERY_COVERAGE_RESERVATIONS,
        request.queries.length,
      );
      const reservedIds = new Set<string>();
      for (const queryRanking of queryRankings) {
        const hit = queryRanking.find((candidate) =>
          !reservedIds.has(candidate.record.memoryId)
        );
        if (hit === undefined) continue;
        const queryIndexes = merged.get(hit.record.memoryId)?.queryIndexes;
        reservedCoverage.push({
          ...hit,
          matchedQueries: queryIndexes === undefined
            ? [hit.query]
            : [...queryIndexes]
              .sort((left, right) => left - right)
              .map((queryIndex) => request.queries[queryIndex]!),
        });
        reservedIds.add(hit.record.memoryId);
        if (reservedCoverage.length >= reservationLimit) break;
      }
    }
    const metadataCoverage = reserveMetadataRoutes(metadataRouteRankings);
    const ordered = [
      ...metadataCoverage,
      ...reservedCoverage,
      ...aggregated,
    ];
    const unique = new Map<string, RetrievalHit>();
    for (const {
      denseRank: _denseRank,
      lexicalRank: _lexicalRank,
      queryIndex: _queryIndex,
      ...hit
    } of ordered) {
      const existing = unique.get(hit.record.memoryId);
      if (existing === undefined) {
        unique.set(hit.record.memoryId, hit);
        continue;
      }
      const filters = mergeMetadataFilters(
        existing.matchedMetadataFilters,
        hit.matchedMetadataFilters,
      );
      unique.set(hit.record.memoryId, {
        ...existing,
        matchedQueries: [...new Set([
          ...(existing.matchedQueries ?? [existing.query]),
          ...(hit.matchedQueries ?? [hit.query]),
        ])],
        ...(filters === undefined ? {} : { matchedMetadataFilters: filters }),
      });
    }
    return finalizeSearchHits([...unique.values()], request, limit);
  }

  searchLexical(
    scopeId: string,
    request: SearchRequest,
  ): RetrievalHit[] {
    return this.rawStore.search(scopeId, request);
  }

  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly RetrievalHit[],
  ): RetrievalHit[] {
    return this.rawStore.expandEvidenceOperator(
      scopeId,
      request,
      context,
      seedHits,
    );
  }

  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore = 0,
    contextAfter = 0,
  ): MemoryRecord[] {
    return this.rawStore.read(
      scopeId,
      memoryIds,
      contextBefore,
      contextAfter,
    );
  }

  getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[] {
    return this.rawStore.getRecords(scopeId, memoryIds);
  }

  findMentionedMemoryIds(scopeId: string, text: string): string[] {
    return this.rawStore.findMentionedMemoryIds(scopeId, text);
  }
}
