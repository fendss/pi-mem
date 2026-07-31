import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestMemorySessions } from "../src/ingest.js";
import { QdrantHttpError } from "../src/qdrant.js";
import type {
  QdrantCollectionInfo,
  QdrantCollectionSpec,
  QdrantCountRequest,
  QdrantVectorPoint,
} from "../src/qdrant.js";
import {
  MemoryStore,
  type EmbeddingProfile,
} from "../src/store.js";
import type { MemoryRecord } from "../src/types.js";
import {
  deterministicQdrantPointId,
  QdrantVectorSynchronizer,
  type QdrantVectorIndexClient,
} from "../src/vector-sync.js";

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

async function fixture(): Promise<{
  path: string;
  store: MemoryStore;
  records: MemoryRecord[];
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-vector-sync-"));
  temporaryPaths.push(root);
  const path = join(root, "memory.sqlite");
  const store = await MemoryStore.create(path);
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
  return {
    path,
    store,
    records: [
      ...store.listScopeRecords("scope-a"),
      ...store.listScopeRecords("scope-b"),
    ],
  };
}

class FakeQdrant implements QdrantVectorIndexClient {
  readonly points = new Map<string, QdrantVectorPoint>();
  ensureCalls = 0;
  upsertCalls = 0;
  failNextUpsert = false;
  nextUpsertError: Error | undefined;
  nextCountError: Error | undefined;
  countAdjustment = 0;

  async ensureCollection(_spec: QdrantCollectionSpec): Promise<void> {
    this.ensureCalls += 1;
  }

  async getCollection(): Promise<QdrantCollectionInfo> {
    return {
      status: "green",
      optimizerStatus: "ok",
      pointsCount: this.points.size,
      indexedVectorsCount: this.points.size,
      dimensions: collection.dimensions,
      indexingThresholdKb: collection.indexingThresholdKb,
      distance: "Cosine",      hnsw: collection.hnsw,
    };
  }

  async upsert(
    _collection: string,
    dimensions: number,
    points: readonly QdrantVectorPoint[],
  ): Promise<void> {
    this.upsertCalls += 1;
    if (this.nextUpsertError) {
      const error = this.nextUpsertError;
      this.nextUpsertError = undefined;
      throw error;
    }
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("temporary Qdrant outage");
    }
    for (const point of points) {
      if (point.vector.length !== dimensions) throw new Error("bad dimensions");
      this.points.set(point.pointId, { ...point, vector: [...point.vector] });
    }
  }

  async count(request: QdrantCountRequest): Promise<number> {
    if (this.nextCountError) {
      const error = this.nextCountError;
      this.nextCountError = undefined;
      throw error;
    }
    const count = [...this.points.values()].filter((point) =>
      point.generationId === request.generationId &&
      point.profileId === request.profileId &&
      (request.scopeId === undefined || point.scopeId === request.scopeId)
    ).length;
    return count + (request.scopeId === undefined ? this.countAdjustment : 0);
  }
}

function begin(store: MemoryStore): void {
  store.beginVectorIndexGeneration({
    generationId: "generation-a",
    collectionName: collection.name,
    profile,
  });
}

function storeAll(
  store: MemoryStore,
  records: readonly MemoryRecord[],
): void {
  store.storeEmbeddingBatchForVectorGeneration(
    "generation-a",
    records.slice(0, 2),
    profile,
    [[1, 0], [0.8, 0.2]],
  );
  store.storeEmbeddingBatchForVectorGeneration(
    "generation-a",
    records.slice(2),
    profile,
    [[0, 1]],
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("durable vector synchronization", () => {
  it("atomically records embeddings and idempotent outbox rows", async () => {
    const { store, records } = await fixture();
    try {
      begin(store);
      expect(() => begin(store)).not.toThrow();
      expect(() => store.beginVectorIndexGeneration({
        generationId: "generation-a",
        collectionName: "other_collection",
        profile,
      })).toThrow(/configuration conflict/u);

      storeAll(store, records);
      const repeatedA = store.storeEmbeddingBatchForVectorGeneration(
        "generation-a",
        records.slice(0, 2),
        profile,
        [[1, 0], [0.8, 0.2]],
      );
      const repeatedB = store.storeEmbeddingBatchForVectorGeneration(
        "generation-a",
        records.slice(2),
        profile,
        [[0, 1]],
      );
      expect(repeatedA.inserted + repeatedB.inserted).toBe(0);
      expect(repeatedA.unchanged + repeatedB.unchanged).toBe(3);
      expect(store.getVectorIndexGeneration("generation-a")).toMatchObject({
        state: "ingesting",
        pendingVectorCount: 3,
        syncedVectorCount: 0,
        expectedVectorCount: 0,
      });
      expect(() => store.assertVectorIndexGenerationReady("generation-a"))
        .toThrow(/not ready/u);
    } finally {
      store.close();
    }
  });

  it("recovers expired claims after reopening SQLite and seals immutable input", async () => {
    const fixtureValue = await fixture();
    let store = fixtureValue.store;
    begin(store);
    storeAll(store, fixtureValue.records);
    const sealed = store.sealVectorIndexGeneration("generation-a");
    expect(sealed).toMatchObject({
      state: "draining",
      expectedVectorCount: 3,
      highWaterSequence: 3,
    });
    expect(sealed.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => store.storeEmbeddingBatchForVectorGeneration(
      "generation-a",
      [fixtureValue.records[0]!],
      profile,
      [[1, 0]],
    )).toThrow(/sealed/u);

    const abandoned = store.claimVectorSyncBatch("generation-a", 2, 100, 1_000);
    expect(abandoned).toHaveLength(2);
    expect(abandoned.map((claim) => claim.attempts)).toEqual([1, 1]);
    store.close();

    store = await MemoryStore.create(fixtureValue.path);
    try {
      const recovered = store.claimVectorSyncBatch(
        "generation-a",
        2,
        100,
        1_101,
      );
      expect(recovered).toHaveLength(2);
      expect(recovered.map((claim) => claim.attempts)).toEqual([2, 2]);
      store.completeVectorSyncBatch(
        "generation-a",
        recovered.map((claim) => claim.sequenceId),
      );
      const remainder = store.claimVectorSyncBatch(
        "generation-a",
        2,
        100,
        1_101,
      );
      expect(remainder).toHaveLength(1);
      store.completeVectorSyncBatch(
        "generation-a",
        remainder.map((claim) => claim.sequenceId),
      );
      const verifying = store.beginVectorIndexVerification("generation-a");
      expect(verifying.state).toBe("verifying");
      expect(() => store.markVectorIndexGenerationReady("generation-a", 2))
        .toThrow(/count mismatch/u);
      const ready = store.markVectorIndexGenerationReady("generation-a", 3);
      expect(ready.state).toBe("ready");
      expect(store.assertVectorIndexGenerationReady("generation-a").state)
        .toBe("ready");
    } finally {
      store.close();
    }
  });

  it("does not enqueue a conflicting pre-existing embedding", async () => {
    const { store, records } = await fixture();
    try {
      store.storeEmbeddingBatch([records[0]!], profile, [[1, 0]]);
      begin(store);
      expect(() => store.storeEmbeddingBatchForVectorGeneration(
        "generation-a",
        [records[0]!],
        profile,
        [[0, 1]],
      )).toThrow(/Derived embedding conflict/u);
      expect(store.getVectorIndexGeneration("generation-a").pendingVectorCount)
        .toBe(0);
    } finally {
      store.close();
    }
  });

  it("asynchronously retries idempotent batches and finalizes a verified generation", async () => {
    const { store, records } = await fixture();
    const qdrant = new FakeQdrant();
    try {
      begin(store);
      storeAll(store, records);
      const synchronizer = new QdrantVectorSynchronizer({
        store,
        client: qdrant,
        generationId: "generation-a",
        collection,
        batchSize: 2,
        concurrentBatches: 1,
        leaseMs: 1_000,
        verificationPollMs: 1,
        verificationTimeoutMs: 1_000,
      });
      qdrant.failNextUpsert = true;
      await expect(synchronizer.synchronizeAvailable())
        .rejects.toThrow(/temporary Qdrant outage/u);
      expect(store.getVectorIndexGeneration("generation-a")).toMatchObject({
        state: "ingesting",
        pendingVectorCount: 3,
        syncedVectorCount: 0,
      });

      const synchronized = await synchronizer.synchronizeAvailable();
      expect(synchronized.synchronizedNow).toBe(3);
      expect(qdrant.points).toHaveLength(3);
      expect([...qdrant.points.values()].every((point) =>
        !("content" in point)
      )).toBe(true);

      const ready = await synchronizer.finalize();
      expect(ready).toMatchObject({
        state: "ready",
        expectedVectorCount: 3,
        syncedVectorCount: 3,
        pendingVectorCount: 0,
      });
      expect(await synchronizer.finalize()).toEqual(ready);
      expect(store.listVectorGenerationScopeCounts("generation-a")).toEqual([
        { scopeId: "scope-a", count: 2 },
        { scopeId: "scope-b", count: 1 },
      ]);
    } finally {
      store.close();
    }
  });

  it("fails a generation whose final Qdrant count is incomplete", async () => {
    const { store, records } = await fixture();
    const qdrant = new FakeQdrant();
    try {
      begin(store);
      storeAll(store, records);
      const synchronizer = new QdrantVectorSynchronizer({
        store,
        client: qdrant,
        generationId: "generation-a",
        collection,
        concurrentBatches: 1,
        verificationPollMs: 1,
        verificationTimeoutMs: 1_000,
      });
      qdrant.countAdjustment = -1;
      await expect(synchronizer.finalize()).rejects.toThrow(/count mismatch/u);
      expect(store.getVectorIndexGeneration("generation-a")).toMatchObject({
        state: "failed",
        lastError: expect.stringMatching(/count mismatch/u),
      });
      expect(() => store.assertVectorIndexGenerationReady("generation-a"))
        .toThrow(/not ready/u);
    } finally {
      store.close();
    }
  });

  it("fails fast and seals the generation on permanent Qdrant authorization errors", async () => {
    const { store, records } = await fixture();
    const qdrant = new FakeQdrant();
    try {
      begin(store);
      storeAll(store, records);
      qdrant.nextUpsertError = new QdrantHttpError(403, "forbidden");
      const synchronizer = new QdrantVectorSynchronizer({
        store,
        client: qdrant,
        generationId: "generation-a",
        collection,
        concurrentBatches: 1,
      });
      await expect(synchronizer.synchronizeAvailable())
        .rejects.toMatchObject({ status: 403 });
      expect(store.getVectorIndexGeneration("generation-a")).toMatchObject({
        state: "failed",
        lastError: "forbidden",
      });
      await expect(synchronizer.finalize()).rejects.toThrow(/failed/u);
    } finally {
      store.close();
    }
  });

  it("keeps transient verification failures resumable", async () => {
    const { store, records } = await fixture();
    const qdrant = new FakeQdrant();
    try {
      begin(store);
      storeAll(store, records);
      qdrant.nextCountError = new QdrantHttpError(503, "temporarily unavailable");
      const synchronizer = new QdrantVectorSynchronizer({
        store,
        client: qdrant,
        generationId: "generation-a",
        collection,
        concurrentBatches: 1,
        verificationPollMs: 1,
        verificationTimeoutMs: 1_000,
      });
      await expect(synchronizer.finalize()).rejects.toMatchObject({ status: 503 });
      expect(store.getVectorIndexGeneration("generation-a").state)
        .toBe("verifying");
      await expect(synchronizer.finalize()).resolves.toMatchObject({
        state: "ready",
        expectedVectorCount: 3,
      });
    } finally {
      store.close();
    }
  });

  it("derives stable UUID point IDs without exposing source IDs", () => {
    const first = deterministicQdrantPointId("scope-a", "memory-a", "profile-a");
    expect(first).toBe(
      deterministicQdrantPointId("scope-a", "memory-a", "profile-a"),
    );
    expect(first).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(first).not.toContain("memory-a");
    expect(deterministicQdrantPointId("scope-b", "memory-a", "profile-a"))
      .not.toBe(first);
  });
});
