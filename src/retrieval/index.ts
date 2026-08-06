export type {
  EvidenceOperatorResult,
  EvidenceOperatorRow,
  EvidenceOperatorSearchContext,
  NumericValueKind,
  RetrievalHit,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  RetrievalProfile,
  SearchOperator,
  SearchOrder,
  SearchRequest,
} from "./model/retrieval.js";
export type {
  EmbeddingIndexStatus,
  EmbeddingIndexStore,
  EmbeddingProfile,
  StoredEmbeddingRecord,
  StoreEmbeddingBatchResult,
} from "./model/embedding.js";
export type {
  Embedder,
  EmbeddingMetrics,
  EmbeddingRequestOptions,
} from "./model/embedder.js";
export {
  createSearchMemory,
  type MemoryToolStore,
  type SearchMemoryResult,
} from "./search-memory.js";
export {
  embeddingInput,
  embeddingProfile,
  indexScopeEmbeddings,
  type EmbeddingIndexResult,
} from "./index-scope-embeddings.js";
export {
  parseSourceTimestamp,
  temporalAnnotation,
} from "./temporal-annotation.js";
