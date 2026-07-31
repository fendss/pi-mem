import {
  SqliteExactDenseRetriever,
  type DenseRetriever,
} from "./dense-retriever.js";
import type { Embedder } from "./embedding.js";
import { embeddingProfile } from "./embedding-index.js";
import {
  bm25Scores,
  PIMEM_HYBRID_BM25_OPTIONS,
  reciprocalRankFusion,
} from "./ranking.js";
import { finalizeSearchHits } from "./search-results.js";
import {
  MemoryStore,
  type EmbeddingIndexStatus,
  type EmbeddingProfile,
  type StoreSearchHit,
} from "./store.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchRequest,
} from "./types.js";
import { episodicPreview } from "./util.js";

export interface HybridRawStore {
  getEmbeddingIndexStatus(
    scopeId: string,
    profile: EmbeddingProfile,
    signal?: AbortSignal,
  ): EmbeddingIndexStatus | Promise<EmbeddingIndexStatus>;
  search(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): StoreSearchHit[] | Promise<StoreSearchHit[]>;
  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
    signal?: AbortSignal,
  ): StoreSearchHit[] | Promise<StoreSearchHit[]>;
  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore?: number,
    contextAfter?: number,
    signal?: AbortSignal,
  ): MemoryRecord[] | Promise<MemoryRecord[]>;
  getRecords(
    scopeId: string,
    memoryIds: string[],
    signal?: AbortSignal,
  ): MemoryRecord[] | Promise<MemoryRecord[]>;
  hasScopeRecords(
    scopeId: string,
    signal?: AbortSignal,
  ): boolean | Promise<boolean>;
  close?(): void | Promise<void>;
}

interface RankedHybridHit extends StoreSearchHit {
  denseRank: number;
  queryIndex: number;
}

function compareFinal(left: RankedHybridHit, right: RankedHybridHit): number {
  const score = right.score - left.score;
  if (score !== 0) return score;
  const denseRank = left.denseRank - right.denseRank;
  if (denseRank !== 0) return denseRank;
  return left.record.memoryId.localeCompare(right.record.memoryId);
}

function candidateText(candidate: { record: MemoryRecord }): string {
  return `${candidate.record.role}: ${candidate.record.content}`;
}

export class HybridMemoryStore {
  readonly rawStore: HybridRawStore;
  readonly embedder: Embedder;
  readonly denseRetriever: DenseRetriever;

  private denseCandidateCount = 0;
  private rerankCandidateCount = 0;

  constructor(
    rawStore: HybridRawStore,
    embedder: Embedder,
    denseRetriever?: DenseRetriever,
  ) {
    this.rawStore = rawStore;
    this.embedder = embedder;
    if (denseRetriever !== undefined) {
      this.denseRetriever = denseRetriever;
    } else {
      if (!(rawStore instanceof MemoryStore)) {
        throw new Error("An asynchronous raw store requires an explicit dense retriever");
      }
      this.denseRetriever = new SqliteExactDenseRetriever(rawStore);
    }
  }

  getRetrievalMetadata(): RetrievalMetadata {
    return {
      retrievalProfile: this.denseRetriever.retrievalProfile,
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
  ): Promise<StoreSearchHit[]> {
    const profile = embeddingProfile(this.embedder);
    const status = await this.rawStore.getEmbeddingIndexStatus(
      scopeId,
      profile,
      signal,
    );
    if (status.total === 0) {
      throw new Error(`Hybrid search scope is empty: ${scopeId}`);
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
    const headroom = Math.max(20, 4 * limit);
    const densePromise = this.denseRetriever.search({
      scopeId,
      profile,
      queryVectors,
      limit: headroom,
      filters: {
        ...(request.sessionIds === undefined
          ? {}
          : { sessionIds: request.sessionIds }),
        ...(request.roles === undefined ? {} : { roles: request.roles }),
        ...(request.after === undefined ? {} : { after: request.after }),
        ...(request.before === undefined ? {} : { before: request.before }),
      },
      ...(signal === undefined ? {} : { signal }),
    });
    const {
      maxPerSession: _ignoredMaxPerSession,
      order: _ignoredOrder,
      ...lexicalBase
    } = request;
    // Qdrant I/O starts before synchronous FTS5; stage 5 moves FTS5 itself to
    // read-only workers so neither path blocks the Agent event loop.
    const lexicalPromise = Promise.all(request.queries.map((query) =>
      this.rawStore.search(
        scopeId,
        {
          ...lexicalBase,
          queries: [query],
          limit: Math.min(100, headroom),
          order: "relevance",
        },
        signal,
      )
    ));
    const [denseRankings, lexicalRankings] = await Promise.all([
      densePromise,
      lexicalPromise,
    ]);
    if (denseRankings.length !== request.queries.length) {
      throw new Error("Dense ranking count does not match query count");
    }
    if (
      denseRankings.every((ranking) => ranking.length === 0) &&
      lexicalRankings.every((ranking) => ranking.length === 0)
    ) return [];

    const perQueryLimit =
      request.maxPerSession === undefined ? limit : headroom;
    const merged = new Map<string, RankedHybridHit>();
    const queryCoverageHits: RankedHybridHit[] = [];
    request.queries.forEach((query, queryIndex) => {
      const denseCandidates = denseRankings[queryIndex]!.map((hit) => ({
        candidate: { record: hit.record },
        cosine: hit.score,
      }));
      const lexicalHits = lexicalRankings[queryIndex]!;
      this.denseCandidateCount += denseCandidates.length;

      const union = new Map<string, { record: MemoryRecord }>();
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
      const bm25 = bm25Scores(
        query,
        candidates.map(candidateText),
        PIMEM_HYBRID_BM25_OPTIONS,
      );
      const bm25Ranking = candidates
        .map((_candidate, index) => index)
        .sort((left, right) => {
          const score = bm25[right]! - bm25[left]!;
          return score !== 0 ? score : left - right;
        });
      const fused = reciprocalRankFusion(
        [denseRanking, lexicalRanking, bm25Ranking],
        60,
        candidates.length,
      );
      const denseRanks = new Map(
        denseRanking.map((candidateIndex, index) => [candidateIndex, index + 1]),
      );
      const queryHits: RankedHybridHit[] = candidates
        .map((candidate, index) => ({
          record: candidate.record,
          query,
          retriever: "pimem-hybrid" as const,
          rank: 0,
          score: fused[index]!,
          preview: episodicPreview(candidate.record.content),
          denseRank: denseRanks.get(index) ?? Number.MAX_SAFE_INTEGER,
          queryIndex,
        }))
        .sort(compareFinal)
        .slice(0, perQueryLimit)
        .map((hit, index) => ({ ...hit, rank: index + 1 }));

      if (queryHits[0]) queryCoverageHits.push(queryHits[0]);
      for (const hit of queryHits) {
        const existing = merged.get(hit.record.memoryId);
        if (
          !existing ||
          hit.score > existing.score ||
          (hit.score === existing.score && hit.denseRank < existing.denseRank) ||
          (hit.score === existing.score &&
            hit.denseRank === existing.denseRank &&
            hit.queryIndex < existing.queryIndex)
        ) {
          merged.set(hit.record.memoryId, hit);
        }
      }
    });

    const ordered = [
      ...(request.queries.length > 1 ? queryCoverageHits : []),
      ...[...merged.values()].sort(compareFinal),
    ];
    const unique = new Map<string, StoreSearchHit>();
    for (const { denseRank: _denseRank, queryIndex: _queryIndex, ...hit } of ordered) {
      if (!unique.has(hit.record.memoryId)) unique.set(hit.record.memoryId, hit);
    }
    return finalizeSearchHits([...unique.values()], request, limit);
  }

  searchLexical(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<StoreSearchHit[]> {
    return Promise.resolve(this.rawStore.search(scopeId, request, signal));
  }

  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
    signal?: AbortSignal,
  ): Promise<StoreSearchHit[]> {
    return Promise.resolve(this.rawStore.expandEvidenceOperator(
      scopeId,
      request,
      context,
      seedHits,
      signal,
    ));
  }

  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore = 0,
    contextAfter = 0,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    return Promise.resolve(this.rawStore.read(
      scopeId,
      memoryIds,
      contextBefore,
      contextAfter,
      signal,
    ));
  }

  getRecords(
    scopeId: string,
    memoryIds: string[],
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    return Promise.resolve(this.rawStore.getRecords(scopeId, memoryIds, signal));
  }

  hasScopeRecords(scopeId: string, signal?: AbortSignal): Promise<boolean> {
    return Promise.resolve(this.rawStore.hasScopeRecords(scopeId, signal));
  }
}
