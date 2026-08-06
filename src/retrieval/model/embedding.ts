import type { MemoryRecord } from "../../memory/index.js";
import type { SearchRequest } from "./retrieval.js";

export interface EmbeddingProfile {
  profileId: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingIndexStatus {
  scopeId: string;
  profileId: string;
  total: number;
  indexed: number;
  missing: number;
}

export interface StoredEmbeddingRecord {
  record: MemoryRecord;
  vector: Float32Array;
}

export interface StoreEmbeddingBatchResult {
  inserted: number;
  unchanged: number;
}

export interface EmbeddingIndexStore {
  getEmbeddingIndexStatus(
    scopeId: string,
    profile: EmbeddingProfile,
  ): EmbeddingIndexStatus;
  listMissingEmbeddingRecords(
    scopeId: string,
    profile: EmbeddingProfile,
  ): MemoryRecord[];
  storeEmbeddingBatch(
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
    vectors: readonly (readonly number[])[],
  ): StoreEmbeddingBatchResult;
  listStoredEmbeddings(
    scopeId: string,
    profile: EmbeddingProfile,
    request?: Omit<SearchRequest, "queries" | "limit">,
  ): StoredEmbeddingRecord[];
}
