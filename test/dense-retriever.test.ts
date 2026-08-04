import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  QdrantDenseRetriever,
  type QdrantDenseSearchClient,
} from "../src/dense-retriever.js";
import { ingestMemorySessions } from "../src/ingest.js";
import type {
  QdrantSearchHit,
  QdrantSearchRequest,
} from "../src/qdrant.js";
import {
  MemoryStore,
  type EmbeddingProfile,
} from "../src/store.js";
import { deterministicQdrantPointId } from "../src/vector-sync.js";

const temporaryPaths: string[] = [];
const profile: EmbeddingProfile = {
  profileId: "profile-a",
  model: "embedding-a",
  dimensions: 2,
};

async function fixture(ready: boolean): Promise<{
  store: MemoryStore;
  client: CapturingClient;
  retriever: QdrantDenseRetriever;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-qdrant-dense-"));
  temporaryPaths.push(root);
  const store = await MemoryStore.create(join(root, "memory.sqlite"));
  await ingestMemorySessions(store, [{
    scopeId: "scope-a",
    sessionId: "session-a",
    timestamp: "2024-01-01T00:00:00.000Z",
    turns: [
      { id: "memory-a", role: "user", content: "alpha" },
      { id: "memory-b", role: "assistant", content: "beta" },
    ],
  }]);
  store.beginVectorIndexGeneration({
    generationId: "generation-a",
    collectionName: "pimem_vectors_v1",
    profile,
  });
  const records = store.listScopeRecords("scope-a");
  store.storeEmbeddingBatchForVectorGeneration(
    "generation-a",
    records,
    profile,
    [[1, 0], [0.9, 0.1]],
  );
  if (ready) {
    store.sealVectorIndexGeneration("generation-a");
    const claims = store.claimVectorSyncBatch("generation-a", 10, 1_000);
    store.completeVectorSyncBatch(
      "generation-a",
      claims.map((claim) => claim.sequenceId),
    );
    store.beginVectorIndexVerification("generation-a");
    store.markVectorIndexGenerationReady("generation-a", records.length);
  }
  const client = new CapturingClient();
  return {
    store,
    client,
    retriever: new QdrantDenseRetriever({
      store,
      client,
      generationId: "generation-a",
      collectionName: "pimem_vectors_v1",
      hnswEf: 256,
    }),
  };
}

class CapturingClient implements QdrantDenseSearchClient {
  readonly requests: QdrantSearchRequest[] = [];
  hits: QdrantSearchHit[] = [];

  search(request: QdrantSearchRequest): Promise<QdrantSearchHit[]> {
    this.requests.push(request);
    return Promise.resolve(this.hits);
  }
}

function hit(
  memoryId: string,
  role: "user" | "assistant",
  score: number,
): QdrantSearchHit {
  return {
    pointId: deterministicQdrantPointId("scope-a", memoryId, profile.profileId),
    score,
    generationId: "generation-a",
    scopeId: "scope-a",
    memoryId,
    sessionId: "session-a",
    role,
    timestamp: "2024-01-01T00:00:00.000Z",
    profileId: profile.profileId,
    contentHash: memoryId === "memory-a"
      ? "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8"
      : "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Qdrant dense retriever", () => {
  it("refuses to search an incomplete vector generation", async () => {
    const { store, client, retriever } = await fixture(false);
    try {
      await expect(retriever.search({
        scopeId: "scope-a",
        profile,
        queryVectors: [[1, 0]],
        limit: 20,
      })).rejects.toThrow(/not ready/u);
      expect(client.requests).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("uses filtered ANN and revalidates ordered raw records in SQLite", async () => {
    const { store, client, retriever } = await fixture(true);
    try {
      client.hits = [
        hit("memory-b", "assistant", 0.8),
        hit("memory-a", "user", 0.9),
      ];
      const rankings = await retriever.search({
        scopeId: "scope-a",
        profile,
        queryVectors: [[1, 0]],
        limit: 20,
        filters: {
          sessionIds: ["session-a"],
          after: "2024-01-01T00:00:00.000Z",
          before: "2024-01-01T00:00:00.000Z",
        },
      });
      expect(retriever.retrievalProfile)
        .toBe("pimem-hybrid-qdrant-hnsw-v1");
      expect(rankings[0]?.map((item) => item.record.memoryId))
        .toEqual(["memory-a", "memory-b"]);
      expect(rankings[0]?.map((item) => item.rank)).toEqual([1, 2]);
      expect(client.requests[0]).toMatchObject({
        collection: "pimem_vectors_v1",
        generationId: "generation-a",
        scopeId: "scope-a",
        profileId: "profile-a",
        sessionIds: ["session-a"],
        after: "2024-01-01T00:00:00.000Z",
        before: "2024-01-01T00:00:00.000Z",
        hnswEf: 256,
      });
    } finally {
      store.close();
    }
  });

  it("hydrates semantic vectors for MMR and rejects missing vectors", async () => {
    const { store, client, retriever } = await fixture(true);
    try {
      client.hits = [{ ...hit("memory-a", "user", 0.9), vector: [1, 0] }];
      const rankings = await retriever.search({
        scopeId: "scope-a",
        profile,
        queryVectors: [[1, 0]],
        limit: 20,
        includeVectors: true,
      });
      expect(client.requests[0]?.withVector).toBe(true);
      expect(rankings[0]?.[0]?.vector).toEqual([1, 0]);

      client.hits = [hit("memory-a", "user", 0.9)];
      await expect(retriever.search({
        scopeId: "scope-a",
        profile,
        queryVectors: [[1, 0]],
        limit: 20,
        includeVectors: true,
      })).rejects.toThrow(/vectors do not match/u);
    } finally {
      store.close();
    }
  });

  it("fails closed on Qdrant-to-SQLite provenance mismatch", async () => {
    const { store, client, retriever } = await fixture(true);
    try {
      client.hits = [{ ...hit("memory-a", "user", 0.9), contentHash: "wrong" }];
      await expect(retriever.search({
        scopeId: "scope-a",
        profile,
        queryVectors: [[1, 0]],
        limit: 20,
      })).rejects.toThrow(/provenance mismatch/u);
    } finally {
      store.close();
    }
  });
});
