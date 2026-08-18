export type {
  EvidenceOperatorResult,
  EvidenceOperatorRow,
  EvidenceOperatorSearchContext,
  NumericValueKind,
  RetrievalHit,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  RetrievalProfile,
  SearchOrder,
  SearchRequest,
} from "./model/retrieval.js";
export type {
  SearchOperatorCatalogEntry,
  SearchOperatorCost,
  SearchOperatorExecutionContext,
  SearchOperatorGuide,
  SearchOperatorInput,
  SearchOperatorOutput,
} from "./model/search-operator.js";
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
  type SearchMemoryResult,
} from "./search-memory.js";
export type {
  MemoryToolStore,
  SearchOperatorStore,
} from "./ports/memory-tool-store.js";
export type { SearchOperator } from "./ports/search-operator.js";
export {
  SearchOperatorRegistry,
  renderSearchOperatorCatalog,
} from "./use-cases/operator-registry.js";
export {
  executeSearchOperator,
  type ExecutedSearchOperator,
} from "./use-cases/execute-operator.js";
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
