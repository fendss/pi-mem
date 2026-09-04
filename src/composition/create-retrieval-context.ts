import {
  type Embedder,
  type RetrievalMetadata,
  type RetrievalProfile,
  type SearchOperatorRegistry,
} from "../retrieval/index.js";
import { OpenAICompatibleEmbedder } from "../retrieval/adapters/openai/openai-compatible-embedder.js";
import { HybridMemoryStore } from "../retrieval/operators/hybrid-search.js";
import type { PiMemRuntimeStore } from "../evidence-agent/index.js";
import type { MemoryStore } from "../platform/sqlite/pimem-store.js";
import { createSearchOperatorRegistry } from "./create-search-operator-registry.js";
import { createQdrantDenseRetriever } from "./qdrant-retrieval.js";

export interface RetrievalContext {
  store: PiMemRuntimeStore;
  metadata: RetrievalMetadata;
  operatorRegistry: SearchOperatorRegistry;
  embedder?: Embedder;
}

export function createRetrievalContext(
  rawStore: MemoryStore,
  profile: RetrievalProfile,
  embedder?: Embedder,
  environment: NodeJS.ProcessEnv = process.env,
): RetrievalContext {
  if (profile === "fts5") {
    return {
      store: rawStore,
      metadata: { retrievalProfile: "fts5" },
      operatorRegistry: createSearchOperatorRegistry(rawStore),
    };
  }
  const selectedEmbedder =
    embedder ?? OpenAICompatibleEmbedder.fromEnvironment(environment);
  const denseRetriever = profile === "pimem-hybrid-qdrant-hnsw-v1"
    ? createQdrantDenseRetriever(rawStore, selectedEmbedder, environment)
    : undefined;
  const store = new HybridMemoryStore(rawStore, selectedEmbedder, denseRetriever);
  return {
    store,
    metadata: store.getRetrievalMetadata(),
    operatorRegistry: createSearchOperatorRegistry(store),
    embedder: selectedEmbedder,
  };
}
