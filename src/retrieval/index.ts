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
  CandidateSet,
  DefinedSearchOperator,
  SearchOperatorCatalogEntry,
  SearchOperatorCatalogIdentity,
  SearchOperatorCombineMethod,
  SearchOperatorCompositionStepTrace,
  SearchOperatorCompositionTrace,
  SearchOperatorCost,
  SearchOperatorDefinition,
  SearchOperatorDefinitionCombineStep,
  SearchOperatorDefinitionSearchStep,
  SearchOperatorDefinitionSnapshot,
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
export type {
  RuntimeSearchOperatorCatalog,
  SearchOperatorCatalog,
} from "./ports/operator-catalog.js";
export type {
  SearchOperatorPluginFactory,
  SearchOperatorPluginModule,
} from "./ports/search-operator-plugin.js";
export {
  SearchOperatorRegistry,
  renderSearchOperatorCatalog,
} from "./use-cases/operator-registry.js";
export {
  buildDeclarativeSearchOperator,
  type BuiltDeclarativeSearchOperator,
} from "./use-cases/build-declarative-operator.js";
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
