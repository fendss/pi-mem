import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteExactDenseRetriever,
  type DenseSearchBatchRequest,
  type DenseSearchHit,
  type DenseRetriever,
} from "../src/dense-retriever.js";
import type {
  Embedder,
  EmbeddingMetrics,
  EmbeddingRequestOptions,
} from "../src/embedding.js";
import { embeddingProfile } from "../src/embedding-index.js";
import { HybridMemoryStore } from "../src/hybrid-search.js";
import { ingestMemorySessions } from "../src/ingest.js";
import { MemoryStore } from "../src/store.js";

const temporaryPaths: string[] = [];

class QueryEmbedder implements Embedder {
  readonly profileId = "hybrid-test-profile";
  readonly model = "hybrid-test-model";
  readonly dimensions = 2;
  readonly maxInputLength = 2048;
  readonly batchSize = 32;
  queryCalls = 0;

  embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(() => [1, 0]));
  }

  embedQueries(
    texts: readonly string[],
    _options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    this.queryCalls += 1;
    return Promise.resolve(texts.map((text) =>
      text === "right" ? [0, 1] : [1, 0],
    ));
  }

  snapshotMetrics(): EmbeddingMetrics {
    return { calls: this.queryCalls, latencyMs: this.queryCalls * 2 };
  }
}

async function createStore(complete = true): Promise<{
  raw: MemoryStore;
  embedder: QueryEmbedder;
  hybrid: HybridMemoryStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-hybrid-"));
  temporaryPaths.push(root);
  const raw = await MemoryStore.create(join(root, "memory.sqlite"));
  await ingestMemorySessions(raw, [
    {
      scopeId: "scope-1",
      sessionId: "session-a",
      timestamp: "2024-01-01T00:00:00",
      turns: [{ id: "m1", role: "user", content: "dense only" }],
    },
    {
      scopeId: "scope-1",
      sessionId: "session-b",
      timestamp: "2024-02-01T00:00:00",
      turns: [{ id: "m2", role: "assistant", content: "middle" }],
    },
    {
      scopeId: "scope-1",
      sessionId: "session-b-2",
      timestamp: "2024-03-01T00:00:00",
      turns: [{ id: "m3", role: "user", content: "needle" }],
    },
    {
      scopeId: "scope-1",
      sessionId: "session-c",
      timestamp: "2024-04-01T00:00:00",
      turns: [{ id: "m4", role: "user", content: "far" }],
    },
  ]);
  const embedder = new QueryEmbedder();
  const records = raw.listScopeRecords("scope-1");
  raw.storeEmbeddingBatch(
    complete ? records : records.slice(0, 3),
    embeddingProfile(embedder),
    [
      [1, 0],
      [0.8, 0.2],
      [0.5, 0.5],
      [0, 1],
    ].slice(0, complete ? 4 : 3),
  );
  return { raw, embedder, hybrid: new HybridMemoryStore(raw, embedder) };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("PiMem hybrid search", () => {
  it("uses the v1.0 exact SQLite dense retriever by default", async () => {
    const { raw, hybrid } = await createStore();
    try {
      expect(hybrid.denseRetriever).toBeInstanceOf(SqliteExactDenseRetriever);
    } finally {
      raw.close();
    }
  });

  it("accepts an asynchronous dense retriever without changing the Agent API", async () => {
    const { raw, embedder } = await createStore();
    const records = raw.listScopeRecords("scope-1");
    const requests: DenseSearchBatchRequest[] = [];
    const denseRetriever: DenseRetriever = {
      retrievalProfile: "pimem-hybrid-qdrant-hnsw-v1",
      search(request): Promise<DenseSearchHit[][]> {
        requests.push(request);
        return Promise.resolve(request.queryVectors.map(() => [
          { record: records[3]!, score: 0.9, rank: 1 },
          { record: records[0]!, score: 0.8, rank: 2 },
        ]));
      },
    };
    const hybrid = new HybridMemoryStore(raw, embedder, denseRetriever);
    try {
      const hits = await hybrid.search("scope-1", {
        queries: ["semantic-only-unmatched"],
        roles: ["user"],
        limit: 2,
      });
      expect(hits.map((hit) => hit.record.memoryId)).toEqual(["m4", "m1"]);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        scopeId: "scope-1",
        limit: 20,
        filters: { roles: ["user"] },
        profile: {
          profileId: embedder.profileId,
          model: embedder.model,
          dimensions: embedder.dimensions,
        },
      });
      expect(requests[0]?.queryVectors).toEqual([[1, 0]]);
      expect(hybrid.getRetrievalMetadata().retrievalProfile)
        .toBe("pimem-hybrid-qdrant-hnsw-v1");
    } finally {
      raw.close();
    }
  });

  it("fails closed before embedding a query when the scope index is incomplete", async () => {
    const { raw, embedder, hybrid } = await createStore(false);
    try {
      await expect(hybrid.search("scope-1", { queries: ["needle"] }))
        .rejects.toThrow(/3\/4 indexed/u);
      expect(embedder.queryCalls).toBe(0);
    } finally {
      raw.close();
    }
  });

  it("fuses dense, FTS5, and candidate-local BM25 through RRF k=60", async () => {
    const { raw, hybrid } = await createStore();
    try {
      const hits = await hybrid.search("scope-1", {
        queries: ["needle"],
        limit: 4,
      });
      expect(hits.map((hit) => hit.record.memoryId)).toEqual([
        "m3",
        "m1",
        "m2",
        "m4",
      ]);
      expect(hits[0]).toMatchObject({
        retriever: "pimem-hybrid",
        rank: 1,
        query: "needle",
      });
      expect(hits[0]?.score).toBeCloseTo(1 / 63 + 1 / 61 + 1 / 61);
      expect(hits[1]?.score).toBeCloseTo(1 / 61 + 1 / 62);
      expect(hits.every((hit) => !("vector" in hit))).toBe(true);
    } finally {
      raw.close();
    }
  });

  it("applies session and time filters before cosine ranking", async () => {
    const { raw, hybrid } = await createStore();
    try {
      const bySession = await hybrid.search("scope-1", {
        queries: ["left"],
        sessionIds: ["session-b", "session-b-2"],
        limit: 10,
      });
      expect(bySession.map((hit) => hit.record.memoryId)).toEqual(["m2", "m3"]);

      const byTime = await hybrid.search("scope-1", {
        queries: ["left"],
        after: "2024-02-01T00:00:00",
        before: "2024-03-01T00:00:00",
        limit: 10,
      });
      expect(byTime.map((hit) => hit.record.memoryId)).toEqual(["m2", "m3"]);

      const byRoleAndTime = await hybrid.search("scope-1", {
        queries: ["left"],
        roles: ["user"],
        order: "reverse-chronological",
        limit: 10,
      });
      expect(byRoleAndTime.map((hit) => hit.record.memoryId)).toEqual([
        "m4",
        "m3",
        "m1",
      ]);
    } finally {
      raw.close();
    }
  });

  it("keeps identical candidate text under distinct immutable memory IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mem-hybrid-duplicates-"));
    temporaryPaths.push(root);
    const raw = await MemoryStore.create(join(root, "memory.sqlite"));
    const embedder = new QueryEmbedder();
    try {
      await ingestMemorySessions(raw, [{
        scopeId: "duplicate-scope",
        sessionId: "duplicate-session",
        turns: [
          { id: "m-a", role: "user", content: "same text" },
          { id: "m-b", role: "user", content: "same text" },
        ],
      }]);
      const records = raw.listScopeRecords("duplicate-scope");
      raw.storeEmbeddingBatch(
        records,
        embeddingProfile(embedder),
        [[1, 0], [1, 0]],
      );
      const hybrid = new HybridMemoryStore(raw, embedder);

      const hits = await hybrid.search("duplicate-scope", {
        queries: ["same text"],
        limit: 2,
      });
      const diversified = await hybrid.search("duplicate-scope", {
        queries: ["same text"],
        limit: 2,
        maxPerSession: 1,
      });

      expect(hits.map((hit) => hit.record.memoryId)).toEqual(["m-a", "m-b"]);
      expect(diversified.map((hit) => hit.record.memoryId)).toEqual(["m-a"]);
    } finally {
      raw.close();
    }
  });

  it("merges independent query rankings by each memory's highest RRF score", async () => {
    const { raw, hybrid } = await createStore();
    try {
      const hits = await hybrid.search("scope-1", {
        queries: ["left", "right"],
        limit: 2,
      });
      expect(hits.map((hit) => hit.record.memoryId)).toEqual(["m1", "m4"]);
      expect(hits.map((hit) => hit.query)).toEqual(["left", "right"]);
      expect(new Set(hits.map((hit) => hit.record.memoryId)).size).toBe(2);
      expect(hybrid.snapshotRetrievalMetrics()).toMatchObject({
        embeddingCalls: 1,
        denseCandidateCount: 8,
        rerankCandidateCount: 8,
      });
    } finally {
      raw.close();
    }
  });
});
