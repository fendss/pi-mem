import type { Embedder } from "./embedding.js";
import type {
  EmbeddingIndexStatus,
  EmbeddingProfile,
  MemoryStore,
} from "./store.js";
import type { MemoryRecord } from "./types.js";

export const EMBEDDING_INPUT_FORMAT = "role: exact-original-content";

export interface EmbeddingIndexResult extends EmbeddingIndexStatus {
  indexedNow: number;
  skipped: number;
}

export function embeddingProfile(embedder: Embedder): EmbeddingProfile {
  return {
    profileId: embedder.profileId,
    model: embedder.model,
    dimensions: embedder.dimensions,
  };
}

export function embeddingInput(role: string, content: string): string {
  return `${role}: ${content}`;
}

export interface RecordEmbeddingIndexResult {
  indexedNow: number;
  skipped: number;
}

export async function indexMemoryRecordEmbeddings(
  store: MemoryStore,
  records: readonly MemoryRecord[],
  embedder: Embedder,
  signal?: AbortSignal,
): Promise<RecordEmbeddingIndexResult> {
  return indexMemoryRecordEmbeddingsInternal(
    store,
    records,
    embedder,
    signal,
  );
}

export async function indexMemoryRecordEmbeddingsForVectorGeneration(
  store: MemoryStore,
  records: readonly MemoryRecord[],
  embedder: Embedder,
  generationId: string,
  signal?: AbortSignal,
): Promise<RecordEmbeddingIndexResult> {
  return indexMemoryRecordEmbeddingsInternal(
    store,
    records,
    embedder,
    signal,
    generationId,
  );
}

async function indexMemoryRecordEmbeddingsInternal(
  store: MemoryStore,
  records: readonly MemoryRecord[],
  embedder: Embedder,
  signal?: AbortSignal,
  generationId?: string,
): Promise<RecordEmbeddingIndexResult> {
  const profile = embeddingProfile(embedder);
  const missingRecords = store.listMissingEmbeddingRecordsForRecords(
    records,
    profile,
  );
  let indexedNow = 0;
  for (let offset = 0; offset < missingRecords.length; offset += embedder.batchSize) {
    const batch = missingRecords.slice(offset, offset + embedder.batchSize);
    const inputs = batch.map((record) =>
      embeddingInput(record.role, record.content)
    );
    const vectors = signal === undefined
      ? await embedder.embedDocuments(inputs)
      : await embedder.embedDocuments(inputs, { signal });
    const stored = generationId === undefined
      ? store.storeEmbeddingBatch(batch, profile, vectors)
      : store.storeEmbeddingBatchForVectorGeneration(
          generationId,
          batch,
          profile,
          vectors,
        );
    indexedNow += stored.inserted;
  }
  if (generationId !== undefined) {
    store.enqueueStoredRecordEmbeddingsForVectorGeneration(
      generationId,
      records,
      profile,
    );
  }
  return {
    indexedNow,
    skipped: records.length - missingRecords.length,
  };
}

export async function indexScopeEmbeddings(
  store: MemoryStore,
  scopeId: string,
  embedder: Embedder,
  signal?: AbortSignal,
): Promise<EmbeddingIndexResult> {
  return indexScopeEmbeddingsInternal(store, scopeId, embedder, signal);
}

export async function indexScopeEmbeddingsForVectorGeneration(
  store: MemoryStore,
  scopeId: string,
  embedder: Embedder,
  generationId: string,
  signal?: AbortSignal,
): Promise<EmbeddingIndexResult> {
  const result = await indexScopeEmbeddingsInternal(
    store,
    scopeId,
    embedder,
    signal,
    generationId,
  );
  store.enqueueStoredScopeEmbeddingsForVectorGeneration(
    generationId,
    scopeId,
    embeddingProfile(embedder),
  );
  return result;
}

async function indexScopeEmbeddingsInternal(
  store: MemoryStore,
  scopeId: string,
  embedder: Embedder,
  signal?: AbortSignal,
  generationId?: string,
): Promise<EmbeddingIndexResult> {
  const profile = embeddingProfile(embedder);
  const before = store.getEmbeddingIndexStatus(scopeId, profile);
  if (before.total === 0) {
    throw new Error(`Cannot index embeddings for empty scope: ${scopeId}`);
  }
  const missingRecords = store.listMissingEmbeddingRecords(scopeId, profile);
  let indexedNow = 0;
  let unchangedNow = 0;
  for (let offset = 0; offset < missingRecords.length; offset += embedder.batchSize) {
    const batch = missingRecords.slice(offset, offset + embedder.batchSize);
    const inputs = batch.map((record) =>
      embeddingInput(record.role, record.content),
    );
    const vectors =
      signal === undefined
        ? await embedder.embedDocuments(inputs)
        : await embedder.embedDocuments(inputs, { signal });
    const stored = generationId === undefined
      ? store.storeEmbeddingBatch(batch, profile, vectors)
      : store.storeEmbeddingBatchForVectorGeneration(
          generationId,
          batch,
          profile,
          vectors,
        );
    indexedNow += stored.inserted;
    unchangedNow += stored.unchanged;
  }
  const after = store.getEmbeddingIndexStatus(scopeId, profile);
  return {
    ...after,
    indexedNow,
    skipped: before.indexed + unchangedNow,
  };
}
