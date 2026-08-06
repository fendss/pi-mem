import {
  type Embedder,
  type RetrievalMetadata,
  type RetrievalProfile,
} from "../retrieval/index.js";
import { OpenAICompatibleEmbedder } from "../retrieval/adapters/openai/openai-compatible-embedder.js";
import { HybridMemoryStore } from "../retrieval/operators/hybrid-search.js";
import type { PiMemRuntimeStore } from "../evidence-agent/index.js";
import type { MemoryStore } from "../platform/sqlite/pimem-store.js";

export interface RetrievalContext {
  store: PiMemRuntimeStore;
  metadata: RetrievalMetadata;
  embedder?: Embedder;
}

export function createRetrievalContext(
  rawStore: MemoryStore,
  profile: RetrievalProfile,
  embedder?: Embedder,
): RetrievalContext {
  if (profile === "fts5") {
    return { store: rawStore, metadata: { retrievalProfile: "fts5" } };
  }
  const selectedEmbedder =
    embedder ?? OpenAICompatibleEmbedder.fromEnvironment();
  const store = new HybridMemoryStore(rawStore, selectedEmbedder);
  return {
    store,
    metadata: store.getRetrievalMetadata(),
    embedder: selectedEmbedder,
  };
}
