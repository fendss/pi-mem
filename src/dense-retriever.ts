import type {
  EmbeddingProfile,
  MemoryStore,
} from "./store.js";
import type { MemoryRecord, SearchRequest } from "./types.js";

export interface DenseSearchHit {
  record: MemoryRecord;
  score: number;
  rank: number;
}

export interface DenseSearchBatchRequest {
  scopeId: string;
  profile: EmbeddingProfile;
  queryVectors: readonly (readonly number[])[];
  limit: number;
  filters?: Omit<SearchRequest, "queries" | "limit">;
  signal?: AbortSignal;
}

/** Internal dense retrieval boundary. Agent-facing search schemas never expose it. */
export interface DenseRetriever {
  search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]>;
}

function cosineSimilarity(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
): number {
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

/** The v1.0 exact implementation, retained as the default and regression oracle. */
export class SqliteExactDenseRetriever implements DenseRetriever {
  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]> {
    const records = this.store.listStoredEmbeddings(
      request.scopeId,
      request.profile,
      request.filters,
    );
    const rankings = request.queryVectors.map((queryVector) =>
      records
        .map((candidate) => ({
          record: candidate.record,
          score: cosineSimilarity(queryVector, candidate.vector),
        }))
        .sort((left, right) => {
          const score = right.score - left.score;
          return score !== 0
            ? score
            : left.record.memoryId.localeCompare(right.record.memoryId);
        })
        .slice(0, request.limit)
        .map((hit, index) => ({ ...hit, rank: index + 1 })),
    );
    return Promise.resolve(rankings);
  }
}
