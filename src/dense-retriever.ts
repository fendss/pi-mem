import type {
  QdrantSearchHit,
  QdrantSearchRequest,
} from "./qdrant.js";
import type {
  EmbeddingProfile,
  MemoryStore,
  VectorIndexGenerationStatus,
} from "./store.js";
import type {
  MemoryRecord,
  RetrievalProfile,
  SearchRequest,
} from "./types.js";
import { deterministicQdrantPointId } from "./vector-sync.js";

export interface DenseSearchHit {
  record: MemoryRecord;
  score: number;
  rank: number;
  vector?: ArrayLike<number>;
}

export interface DenseSearchBatchRequest {
  scopeId: string;
  profile: EmbeddingProfile;
  queryVectors: readonly (readonly number[])[];
  limit: number;
  filters?: Omit<SearchRequest, "queries" | "limit">;
  includeVectors?: boolean;
  signal?: AbortSignal;
}

/** Internal dense retrieval boundary. Agent-facing search schemas never expose it. */
export interface DenseRetriever {
  readonly retrievalProfile: RetrievalProfile;
  search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]>;
}

export interface QdrantDenseSearchClient {
  search(request: QdrantSearchRequest): Promise<QdrantSearchHit[]>;
}

export interface QdrantDenseMetadataStore {
  assertVectorIndexGenerationReady(
    generationId: string,
    signal?: AbortSignal,
  ): VectorIndexGenerationStatus | Promise<VectorIndexGenerationStatus>;
  getRecords(
    scopeId: string,
    memoryIds: string[],
    signal?: AbortSignal,
  ): MemoryRecord[] | Promise<MemoryRecord[]>;
}

export interface QdrantDenseRetrieverOptions {
  store: QdrantDenseMetadataStore;
  client: QdrantDenseSearchClient;
  generationId: string;
  collectionName: string;
  hnswEf?: number;
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
  readonly retrievalProfile = "pimem-hybrid" as const;
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
          ...(request.includeVectors ? { vector: candidate.vector } : {}),
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

/** Filtered HNSW retrieval whose returned IDs are revalidated against SQLite. */
export class QdrantDenseRetriever implements DenseRetriever {
  readonly retrievalProfile = "pimem-hybrid-qdrant-hnsw-v1" as const;
  private readonly store: QdrantDenseMetadataStore;
  private readonly client: QdrantDenseSearchClient;
  private readonly generationId: string;
  private readonly collectionName: string;
  private readonly hnswEf: number;

  constructor(options: QdrantDenseRetrieverOptions) {
    if (!options.generationId.trim() || !options.collectionName.trim()) {
      throw new Error("Qdrant dense generation and collection must not be empty");
    }
    const hnswEf = options.hnswEf ?? 512;
    if (!Number.isSafeInteger(hnswEf) || hnswEf <= 0 || hnswEf > 10_000) {
      throw new Error("Qdrant dense hnswEf must be between 1 and 10000");
    }
    this.store = options.store;
    this.client = options.client;
    this.generationId = options.generationId;
    this.collectionName = options.collectionName;
    this.hnswEf = hnswEf;
  }

  private async hydrate(
    scopeId: string,
    hits: readonly QdrantSearchHit[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<DenseSearchHit[]> {
    if (new Set(hits.map((hit) => hit.memoryId)).size !== hits.length) {
      throw new Error("Qdrant dense results contain duplicate memory IDs");
    }
    const rawRecords = await this.store.getRecords(
      scopeId,
      hits.map((hit) => hit.memoryId),
      signal,
    );
    const records = new Map(
      rawRecords.map((record) => [record.memoryId, record]),
    );
    return hits.map((hit) => {
      const record = records.get(hit.memoryId);
      if (!record) {
        throw new Error(`Qdrant returned a missing scoped memory: ${hit.memoryId}`);
      }
      if (
        hit.pointId !== deterministicQdrantPointId(
          scopeId,
          hit.memoryId,
          hit.profileId,
        ) ||
        hit.contentHash !== record.contentHash ||
        hit.sessionId !== record.sessionId ||
        hit.role !== record.role ||
        hit.timestamp !== record.timestamp
      ) {
        throw new Error(`Qdrant provenance mismatch for memory: ${hit.memoryId}`);
      }
      return {
        record,
        score: hit.score,
        rank: 0,
        ...(hit.vector === undefined ? {} : { vector: hit.vector }),
      };
    }).sort((left, right) => {
      const score = right.score - left.score;
      return score !== 0
        ? score
        : left.record.memoryId.localeCompare(right.record.memoryId);
    }).slice(0, limit).map((hit, index) => ({ ...hit, rank: index + 1 }));
  }

  async search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]> {
    const generation = await this.store.assertVectorIndexGenerationReady(
      this.generationId,
      request.signal,
    );
    if (
      generation.collectionName !== this.collectionName ||
      generation.profile.profileId !== request.profile.profileId ||
      generation.profile.model !== request.profile.model ||
      generation.profile.dimensions !== request.profile.dimensions
    ) {
      throw new Error(`Qdrant dense generation mismatch: ${this.generationId}`);
    }
    for (const vector of request.queryVectors) {
      if (
        vector.length !== request.profile.dimensions ||
        vector.some((value) => !Number.isFinite(value))
      ) {
        throw new Error("Qdrant query vector does not match the embedding profile");
      }
    }
    const filters = request.filters;
    const rankings = await Promise.all(request.queryVectors.map(async (vector) => {
      const hits = await this.client.search({
        collection: this.collectionName,
        vector,
        generationId: this.generationId,
        scopeId: request.scopeId,
        profileId: request.profile.profileId,
        ...(filters?.sessionIds === undefined
          ? {}
          : { sessionIds: filters.sessionIds }),
        ...(filters?.roles === undefined ? {} : { roles: filters.roles }),
        ...(filters?.after === undefined ? {} : { after: filters.after }),
        ...(filters?.before === undefined ? {} : { before: filters.before }),
        limit: request.limit,
        hnswEf: Math.min(10_000, Math.max(this.hnswEf, request.limit * 2)),
        ...(request.includeVectors ? { withVector: true } : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (
        request.includeVectors &&
        hits.some((hit) =>
          hit.vector === undefined ||
          hit.vector.length !== request.profile.dimensions
        )
      ) {
        throw new Error("Qdrant dense vectors do not match the embedding profile");
      }
      return this.hydrate(
        request.scopeId,
        hits,
        request.limit,
        request.signal,
      );
    }));
    return rankings;
  }
}
