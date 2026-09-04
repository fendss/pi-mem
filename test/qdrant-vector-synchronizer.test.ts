import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestMemorySessions } from "../src/memory/index.js";
import { MemoryStore } from "../src/platform/sqlite/pimem-store.js";
import {
  deterministicQdrantPointId,
  qdrantCollectionIndexReady,
  QdrantVectorSynchronizer,
  type EmbeddingProfile,
  type QdrantCollectionInfo,
  type QdrantCollectionSpec,
  type QdrantCountRequest,
  type QdrantVectorIndexClient,
  type QdrantVectorPoint,
} from "../src/retrieval/index.js";

const temporaryPaths: string[] = [];
const profile: EmbeddingProfile = {
  profileId: "profile-a",
  model: "embedding-a",
  dimensions: 2,
};
const collection: QdrantCollectionSpec = {
  name: "pimem_vectors_v1",
  dimensions: 2,
  indexingThresholdKb: 10_000,
  hnsw: { m: 32, efConstruct: 200, fullScanThresholdKb: 1_000 },
};

class FakeQdrant implements QdrantVectorIndexClient {
  readonly points = new Map<string, QdrantVectorPoint>();
  failNextUpsert = false;

  ensureCollection(): Promise<void> {
    return Promise.resolve();
  }

  getCollection(): Promise<QdrantCollectionInfo> {
    return Promise.resolve({
      status: "green",
      optimizerStatus: "ok",
      pointsCount: this.points.size,
      indexedVectorsCount: this.points.size,
      segmentsCount: 1,
      dimensions: collection.dimensions,
      indexingThresholdKb: collection.indexingThresholdKb,
      distance: "Cosine",
      hnsw: collection.hnsw,
    });
  }

  upsert(
    _collection: string,
    _dimensions: number,
    points: readonly QdrantVectorPoint[],
  ): Promise<void> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      return Promise.reject(new Error("temporary Qdrant outage"));
    }
    for (const point of points) this.points.set(point.pointId, point);
    return Promise.resolve();
  }

  count(request: QdrantCountRequest): Promise<number> {
    return Promise.resolve([...this.points.values()].filter((point) =>
      point.generationId === request.generationId &&
      point.profileId === request.profileId &&
      (request.scopeId === undefined || point.scopeId === request.scopeId)
    ).length);
  }
}

async function fixture(): Promise<MemoryStore> {
  const root = await mkdtemp(join(tmpdir(), "pimem-vector-sync-"));
  temporaryPaths.push(root);
  const store = await MemoryStore.create(join(root, "memory.sqlite"));
  await ingestMemorySessions(store, [
    {
      scopeId: "scope-a",
      sessionId: "session-a",
      turns: [
        { id: "memory-a", role: "user", content: "alpha" },
        { id: "memory-b", role: "assistant", content: "beta" },
      ],
    },
    {
      scopeId: "scope-b",
      sessionId: "session-b",
      turns: [{ id: "memory-c", role: "user", content: "gamma" }],
    },
  ]);
  store.storeEmbeddingBatch(
    store.listScopeRecords("scope-a"),
    profile,
    [[1, 0], [0.8, 0.2]],
  );
  store.storeEmbeddingBatch(
    store.listScopeRecords("scope-b"),
    profile,
    [[0, 1]],
  );
  store.beginVectorIndexGeneration({
    generationId: "generation-a",
    collectionName: collection.name,
    profile,
  });
  store.enqueueStoredScopeEmbeddingsForVectorGeneration(
    "generation-a",
    "scope-a",
    profile,
  );
  store.enqueueStoredScopeEmbeddingsForVectorGeneration(
    "generation-a",
    "scope-b",
    profile,
  );
  return store;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("durable Qdrant generation", () => {
  it("accepts settled per-segment exact-scan tails", () => {
    expect(qdrantCollectionIndexReady({
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 0,
      indexedVectorsCount: 0,
      segmentsCount: 0,
    }, 1_024, 100)).toBe(true);
    expect(qdrantCollectionIndexReady({
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 8_103,
      indexedVectorsCount: 8_094,
      segmentsCount: 1,
    }, 1_024, 100)).toBe(true);
    expect(qdrantCollectionIndexReady({
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 8_103,
      indexedVectorsCount: 8_000,
      segmentsCount: 1,
    }, 1_024, 100)).toBe(false);
    expect(qdrantCollectionIndexReady({
      status: "green",
      optimizerStatus: "ok",
      pointsCount: 16_206,
      indexedVectorsCount: 8_103,
      segmentsCount: 1,
    }, 1_024, 100)).toBe(false);
  });

  it("retries idempotent batches and publishes a verified generation", async () => {
    const store = await fixture();
    const qdrant = new FakeQdrant();
    try {
      const synchronizer = new QdrantVectorSynchronizer({
        store,
        client: qdrant,
        generationId: "generation-a",
        collection,
        batchSize: 2,
        concurrentBatches: 1,
        verificationPollMs: 1,
        verificationTimeoutMs: 1_000,
      });
      qdrant.failNextUpsert = true;
      await expect(synchronizer.synchronizeAvailable())
        .rejects.toThrow(/temporary Qdrant outage/u);
      expect(store.getVectorIndexGeneration("generation-a")).toMatchObject({
        state: "ingesting",
        pendingVectorCount: 3,
      });

      const ready = await synchronizer.finalize();
      expect(ready).toMatchObject({
        state: "ready",
        expectedVectorCount: 3,
        syncedVectorCount: 3,
      });
      expect(qdrant.points).toHaveLength(3);
      expect([...qdrant.points.values()].every((point) =>
        !("content" in point)
      )).toBe(true);
      expect(await synchronizer.finalize()).toEqual(ready);
    } finally {
      store.close();
    }
  });

  it("derives stable opaque UUID point IDs", () => {
    const id = deterministicQdrantPointId(
      "generation-a",
      "scope-a",
      "memory-a",
      "profile-a",
    );
    expect(id).toBe(deterministicQdrantPointId(
      "generation-a",
      "scope-a",
      "memory-a",
      "profile-a",
    ));
    expect(id).not.toBe(deterministicQdrantPointId(
      "generation-b",
      "scope-a",
      "memory-a",
      "profile-a",
    ));
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(id).not.toContain("memory-a");
  });
});
