#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { ingestMemorySessions } from "../dist/ingest.js";
import { QdrantClient } from "../dist/qdrant.js";
import { MemoryStore } from "../dist/store.js";
import {
  deterministicQdrantPointId,
  QdrantVectorSynchronizer,
} from "../dist/vector-sync.js";

const [phase, baseUrl, databasePath] = process.argv.slice(2);
if (!new Set(["seed", "verify"]).has(phase) || !baseUrl || !databasePath) {
  throw new Error(
    "Usage: qdrant_vector_sync_integration_client.mjs seed|verify URL DATABASE",
  );
}

const generationId = "generation-sync-a";
const profile = {
  profileId: "profile-sync-a",
  model: "embedding-sync-a",
  dimensions: 4,
};
const collection = {
  name: "pimem_vectors_sync_v1",
  dimensions: 4,
  hnsw: { m: 32, efConstruct: 200, fullScanThreshold: 1_000 },
};
const client = new QdrantClient({ baseUrl, timeoutMs: 5_000 });

async function waitReady() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Qdrant did not become ready", { cause: lastError });
}

await waitReady();
if (phase === "seed") await rm(databasePath, { force: true });
const store = await MemoryStore.create(databasePath);
try {
  if (phase === "seed") {
    await ingestMemorySessions(store, [
      {
        scopeId: "scope-sync-a",
        sessionId: "session-a",
        turns: [
          { id: "memory-sync-a", role: "user", content: "alpha" },
          { id: "memory-sync-b", role: "assistant", content: "beta" },
        ],
      },
      {
        scopeId: "scope-sync-b",
        sessionId: "session-b",
        turns: [{ id: "memory-sync-c", role: "user", content: "gamma" }],
      },
    ]);
    store.beginVectorIndexGeneration({
      generationId,
      collectionName: collection.name,
      profile,
    });
    const scopeA = store.listScopeRecords("scope-sync-a");
    const scopeB = store.listScopeRecords("scope-sync-b");
    store.storeEmbeddingBatchForVectorGeneration(
      generationId,
      scopeA,
      profile,
      [[1, 0, 0, 0], [0.9, 0.1, 0, 0]],
    );
    store.storeEmbeddingBatchForVectorGeneration(
      generationId,
      scopeB,
      profile,
      [[0, 1, 0, 0]],
    );
    const synchronizer = new QdrantVectorSynchronizer({
      store,
      client,
      generationId,
      collection,
      batchSize: 2,
      concurrentBatches: 2,
      verificationPollMs: 100,
      verificationTimeoutMs: 60_000,
    });
    const asynchronous = await synchronizer.synchronizeAvailable();
    if (asynchronous.synchronizedNow !== 3) {
      throw new Error(`Unexpected asynchronous sync count: ${asynchronous.synchronizedNow}`);
    }
    await synchronizer.finalize();
  }

  const generation = store.assertVectorIndexGenerationReady(generationId);
  const count = await client.count({
    collection: collection.name,
    generationId,
    profileId: profile.profileId,
  });
  if (count !== 3 || generation.expectedVectorCount !== 3) {
    throw new Error(`Persisted generation mismatch: ${count}/3`);
  }
  const hits = await client.search({
    collection: collection.name,
    vector: [1, 0, 0, 0],
    generationId,
    scopeId: "scope-sync-a",
    profileId: profile.profileId,
    limit: 10,
    hnswEf: 256,
  });
  const expected = new Set([
    deterministicQdrantPointId(
      "scope-sync-a",
      "memory-sync-a",
      profile.profileId,
    ),
    deterministicQdrantPointId(
      "scope-sync-a",
      "memory-sync-b",
      profile.profileId,
    ),
  ]);
  if (hits.length !== 2 || hits.some((hit) => !expected.has(hit.pointId))) {
    throw new Error(`Vector sync scope isolation mismatch: ${JSON.stringify(hits)}`);
  }
  process.stdout.write(`${JSON.stringify({
    phase,
    generationState: generation.state,
    expectedVectorCount: generation.expectedVectorCount,
    qdrantVectorCount: count,
    isolatedHits: hits.length,
  })}\n`);
} finally {
  store.close();
}
