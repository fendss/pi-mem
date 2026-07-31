#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { OpenAICompatibleEmbedder } from "../dist/embedding.js";
import { embeddingProfile } from "../dist/embedding-index.js";
import { QdrantClient } from "../dist/qdrant.js";
import { MemoryStore } from "../dist/store.js";
import { QdrantVectorSynchronizer } from "../dist/vector-sync.js";

const [databasePath, privateQuestionsPath, qdrantUrl, generationId, collectionName] = process.argv.slice(2);
if (!collectionName) {
  throw new Error("database, private questions, Qdrant URL, generation, and collection are required");
}
const dimensions = Number(process.env.PIMEM_EMBEDDING_DIMENSIONS ?? 1024);
const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
  return value;
};
const questions = (await readFile(privateQuestionsPath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const scopeIds = [...new Set(questions.map((question) => String(question.scopeId)))].sort();
const store = await MemoryStore.create(databasePath);
try {
  const profile = embeddingProfile(OpenAICompatibleEmbedder.fromEnvironment());
  if (profile.dimensions !== dimensions) throw new Error("Embedding dimension mismatch");
  const generation = store.beginVectorIndexGeneration({
    generationId,
    collectionName,
    profile,
  });
  let enqueued = 0;
  if (generation.state === "ingesting") {
    let processed = 0;
    for (const scopeId of scopeIds) {
      enqueued += store.enqueueStoredScopeEmbeddingsForVectorGeneration(
        generationId,
        scopeId,
        profile,
      );
      processed += 1;
      if (processed % 25 === 0 || processed === scopeIds.length) {
        process.stderr.write(`Enqueued scopes ${processed}/${scopeIds.length}, new rows ${enqueued}\n`);
      }
    }
  } else {
    process.stderr.write(`Resuming generation from state ${generation.state}\n`);
  }
  const synchronizer = new QdrantVectorSynchronizer({
    store,
    client: new QdrantClient({
      baseUrl: qdrantUrl,
      timeoutMs: integer("PIMEM_QDRANT_TIMEOUT_MS", 120_000),
    }),
    generationId,
    collection: {
      name: collectionName,
      dimensions,
      indexingThresholdKb: integer("PIMEM_QDRANT_INDEXING_THRESHOLD_KB", 100),
      hnsw: {
        m: integer("PIMEM_QDRANT_HNSW_M", 32),
        efConstruct: integer("PIMEM_QDRANT_EF_CONSTRUCT", 200),
        fullScanThresholdKb: integer("PIMEM_QDRANT_FULL_SCAN_THRESHOLD_KB", 100),
      },
    },
    batchSize: integer("PIMEM_QDRANT_SYNC_BATCH_SIZE", 512),
    concurrentBatches: integer("PIMEM_QDRANT_SYNC_CONCURRENCY", 8),
    verificationTimeoutMs: 3_600_000,
  });
  const ready = await synchronizer.finalize();
  process.stdout.write(`${JSON.stringify({
    schema_version: "pimem-longmemeval-qdrant-index/v1",
    generation_id: ready.generationId,
    state: ready.state,
    scopes: scopeIds.length,
    expected_vectors: ready.expectedVectorCount,
    synchronized_vectors: ready.syncedVectorCount,
    source_fingerprint: ready.sourceFingerprint,
    collection: ready.collectionName,
    profile: ready.profile,
  }, null, 2)}\n`);
} finally {
  store.close();
}
