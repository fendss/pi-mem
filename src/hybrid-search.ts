import type { Embedder } from "./embedding.js";
import { embeddingProfile } from "./embedding-index.js";
import {
  bm25Scores,
  PIMEM_HYBRID_BM25_OPTIONS,
  reciprocalRankFusion,
} from "./ranking.js";
import { finalizeSearchHits } from "./search-results.js";
import type {
  MemoryStore,
  StoreSearchHit,
  StoredEmbeddingRecord,
} from "./store.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchRequest,
} from "./types.js";
import { episodicPreview } from "./util.js";

interface RankedHybridHit extends StoreSearchHit {
  denseRank: number;
  queryIndex: number;
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
  return left.record.memoryId.localeCompare(right.record.memoryId);
}

function candidateText(candidate: StoredEmbeddingRecord): string {
  return `${candidate.record.role}: ${candidate.record.content}`;
}

export class HybridMemoryStore {
  readonly rawStore: MemoryStore;
  readonly embedder: Embedder;

  private denseCandidateCount = 0;
  private rerankCandidateCount = 0;

  constructor(rawStore: MemoryStore, embedder: Embedder) {
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
  ): Promise<StoreSearchHit[]> {
    const profile = embeddingProfile(this.embedder);
    const status = this.rawStore.getEmbeddingIndexStatus(scopeId, profile);
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
    const records = this.rawStore.listStoredEmbeddings(scopeId, profile, {
      ...(request.sessionIds === undefined
        ? {}
        : { sessionIds: request.sessionIds }),
      ...(request.roles === undefined ? {} : { roles: request.roles }),
      ...(request.after === undefined ? {} : { after: request.after }),
      ...(request.before === undefined ? {} : { before: request.before }),
    });
    if (records.length === 0) return [];

    const headroom = Math.max(20, 4 * limit);
    const perQueryLimit =
      request.maxPerSession === undefined ? limit : headroom;
    const merged = new Map<string, RankedHybridHit>();
    const queryCoverageHits: RankedHybridHit[] = [];
    request.queries.forEach((query, queryIndex) => {
      const queryVector = queryVectors[queryIndex]!;
      const denseCandidates = records
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
      this.denseCandidateCount += denseCandidates.length;
      this.rerankCandidateCount += denseCandidates.length;

      const bm25 = bm25Scores(
        query,
        denseCandidates.map(({ candidate }) => candidateText(candidate)),
        PIMEM_HYBRID_BM25_OPTIONS,
      );
      const denseRanking = denseCandidates.map((_candidate, index) => index);
      const bm25Ranking = [...denseRanking].sort((left, right) => {
        const score = bm25[right]! - bm25[left]!;
        if (score !== 0) return score;
        return left - right;
      });
      const fused = reciprocalRankFusion(
        [denseRanking, bm25Ranking],
        60,
        denseCandidates.length,
      );
      const queryHits: RankedHybridHit[] = denseCandidates
        .map(({ candidate }, index) => ({
          record: candidate.record,
          query,
          retriever: "pimem-hybrid" as const,
          rank: 0,
          score: fused[index]!,
          preview: episodicPreview(candidate.record.content),
          denseRank: index + 1,
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

  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
  ): StoreSearchHit[] {
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
