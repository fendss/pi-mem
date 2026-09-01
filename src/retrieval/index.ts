export type {
  EvidenceOperatorResult,
  EvidenceOperatorRow,
  EvidenceOperatorSearchContext,
  NumericValueKind,
  RetrievalHit,
  RetrievalMetadataFilter,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  RetrievalProfile,
  SearchCoverageProgress,
  SearchFrontierStatus,
  SearchOrder,
  SearchQueryCoverageProgress,
  SearchRequest,
} from "./model/search.js";
export {
  assertPassageMatchesRecord,
  memoryPassages,
  projectSearchHitsToPassages,
  rankMemoryPassages,
  retrievalHitIdentity,
  sourceQuoteMatchScore,
  MAX_PASSAGES_PER_PARENT_HIT,
  MAX_PASSAGE_CHARS,
  MAX_PASSAGE_OVERLAP_CHARS,
  PASSAGE_VIEW_VERSION,
  TARGET_PASSAGE_CHARS,
  type MemoryPassage,
} from "./model/passage.js";
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
  SearchOperatorDefinitionAnnotateStep,
  SearchOperatorDefinitionCombineStep,
  SearchOperatorDefinitionDedupeStep,
  SearchOperatorDefinitionDiversifyStep,
  SearchOperatorDefinitionFilterStep,
  SearchOperatorDefinitionLimitStep,
  SearchOperatorDefinitionSearchStep,
  SearchOperatorDefinitionSnapshot,
  SearchOperatorDefinitionSortStep,
  SearchOperatorDefinitionStep,
  SearchOperatorExecutionContext,
  SearchOperatorGuide,
  SearchOperatorInput,
  SearchOperatorOutput,
} from "./model/operator.js";
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
  type SearchMemoryBranch,
  type SearchMemoryParams,
  type SearchMemoryResult,
} from "./use-cases/search.js";
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
} from "./use-cases/compose-operator.js";
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
