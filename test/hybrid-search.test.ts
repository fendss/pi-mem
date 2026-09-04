import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Embedder,
  EmbeddingMetrics,
  EmbeddingRequestOptions,
  DenseRetriever,
} from "../src/retrieval/index.js";
import { embeddingProfile } from "../src/retrieval/index.js";
import { HybridMemoryStore } from "../src/retrieval/operators/hybrid-search.js";
import { ingestMemorySessions } from "../src/memory/index.js";
import { MemoryStore } from "../src/platform/sqlite/pimem-store.js";

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

class CoverageEmbedder implements Embedder {
  readonly profileId = "hybrid-coverage-profile";
  readonly model = "hybrid-coverage-model";
  readonly dimensions = 16;
  readonly maxInputLength = 2048;
  readonly batchSize = 32;
  queryCalls = 0;

  embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(() => Array(16).fill(0) as number[]));
  }

  embedQueries(texts: readonly string[]): Promise<number[][]> {
    this.queryCalls += 1;
    return Promise.resolve(texts.map((text) => {
      const index = Number(/\bq(\d{1,2})\b/u.exec(text)?.[1] ?? "0");
      return Array.from({ length: 16 }, (_, item) => item === index ? 1 : 0);
    }));
  }

  snapshotMetrics(): EmbeddingMetrics {
    return { calls: this.queryCalls, latencyMs: 0 };
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

async function createCoverageStore(): Promise<{
  raw: MemoryStore;
  hybrid: HybridMemoryStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-hybrid-coverage-"));
  temporaryPaths.push(root);
  const raw = await MemoryStore.create(join(root, "memory.sqlite"));
  const queryTokens = Array.from({ length: 16 }, (_, index) => `q${String(index)}`);
  await ingestMemorySessions(raw, [
    ...queryTokens.map((token, index) => ({
      scopeId: "coverage-scope",
      sessionId: `anchor-session-${String(index)}`,
      timestamp: "2023-03-01T10:00:00",
      turns: [{
        id: `anchor-${String(index).padStart(2, "0")}`,
        role: "user" as const,
        content: `${token} unique anchor`,
      }],
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      scopeId: "coverage-scope",
      sessionId: `global-session-${String(index)}`,
      timestamp: index < 4
        ? "2023-03-15T10:00:00"
        : "2023-03-20T10:00:00",
      turns: [{
        id: `global-${String(index).padStart(2, "0")}`,
        role: "user" as const,
        content: `${queryTokens.join(" ")} shared global evidence ${String(index)}`,
      }],
    })),
  ]);
  const embedder = new CoverageEmbedder();
  const records = raw.listScopeRecords("coverage-scope");
  const sharedVector = Array.from({ length: 16 }, () => 0.25);
  raw.storeEmbeddingBatch(
    records,
    embeddingProfile(embedder),
    records.map((record) => {
      const anchor = /^anchor-(\d{2})$/u.exec(record.memoryId);
      if (anchor === null) return sharedVector;
      const index = Number(anchor[1]);
      return Array.from({ length: 16 }, (_, item) => item === index ? 1 : 0);
    }),
  );
  return { raw, hybrid: new HybridMemoryStore(raw, embedder) };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("PiMem hybrid search", () => {
  it("accepts a Qdrant dense adapter without changing the Agent hit schema", async () => {
    const { raw, embedder } = await createStore();
    try {
      const record = raw.getRecords("scope-1", ["m4"])[0]!;
      const dense: DenseRetriever = {
        retrievalProfile: "pimem-hybrid-qdrant-hnsw-v1",
        vectorGenerationId: "generation-a",
        vectorCollection: "pimem_vectors_v1",
        search: () => Promise.resolve([[{ record, score: 0.99, rank: 1 }]]),
      };
      const hybrid = new HybridMemoryStore(raw, embedder, dense);
      expect(hybrid.getRetrievalMetadata()).toMatchObject({
        retrievalProfile: "pimem-hybrid-qdrant-hnsw-v1",
        vectorGenerationId: "generation-a",
        vectorCollection: "pimem_vectors_v1",
      });
      const hits = await hybrid.search("scope-1", {
        queries: ["no lexical match"],
        limit: 1,
      });
      expect(hits[0]).toMatchObject({
        retriever: "pimem-hybrid",
        record: { memoryId: "m4" },
      });
    } finally {
      raw.close();
    }
  });

  it("treats a known empty scope as a valid search with no hits", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mem-hybrid-empty-"));
    temporaryPaths.push(root);
    const raw = await MemoryStore.create(join(root, "memory.sqlite"));
    const embedder = new QueryEmbedder();
    try {
      const hybrid = new HybridMemoryStore(raw, embedder);
      await expect(hybrid.search("empty-scope", { queries: ["anything"] }))
        .resolves.toEqual([]);
      expect(embedder.queryCalls).toBe(0);
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

  it("fuses independent dense and FTS5 rankings through RRF k=60", async () => {
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
      expect(hits[0]?.score).toBeCloseTo(1 / 63 + 1 / 61);
      expect(hits[1]?.score).toBeCloseTo(1 / 61);
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

  it("adds a bounded date-metadata route only for a date already in the query", async () => {
    const { raw, hybrid } = await createStore();
    try {
      const hits = await hybrid.search("scope-1", {
        queries: ["left state on 2024-03-01"],
        limit: 2,
      });

      expect(hits.map((hit) => hit.record.memoryId)).toContain("m3");
      expect(hits.map((hit) => hit.record.memoryId)).toContain("m1");
      expect(
        hits.find((hit) => hit.record.memoryId === "m3")
          ?.matchedMetadataFilters,
      ).toEqual([{
        source: "agent-query",
        query: "left state on 2024-03-01",
        expression: "2024-03-01",
        after: "2024-03-01T00:00:00",
        before: "2024-03-01T23:59:59",
      }]);

      const ambiguous = await hybrid.search("scope-1", {
        queries: ["changes from 2024-01-01 to 2024-03-01"],
        limit: 2,
      });
      expect(ambiguous.every((hit) =>
        hit.matchedMetadataFilters === undefined
      )).toBe(true);
      const partlyInvalid = await hybrid.search("scope-1", {
        queries: ["compare 2024-02-30 with 2024-03-01"],
        limit: 2,
      });
      expect(partlyInvalid.every((hit) =>
        hit.matchedMetadataFilters === undefined
      )).toBe(true);
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

  it("reserves candidates for independent queries before applying the shared limit", async () => {
    const { raw, hybrid } = await createStore();
    try {
      const hits = await hybrid.search("scope-1", {
        queries: ["left", "right"],
        limit: 2,
      });
      expect(hits.map((hit) => hit.record.memoryId)).toEqual(["m1", "m4"]);
      expect(hits.map((hit) => hit.query)).toEqual(["left", "right"]);
      expect(hits.map((hit) => hit.matchedQueries)).toEqual([
        ["left", "right"],
        ["left", "right"],
      ]);
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

  it("keeps no-date top 20 stable while bounding query reservations to half a page", async () => {
    const { raw, hybrid } = await createCoverageStore();
    try {
      const queries = Array.from({ length: 16 }, (_, index) => `q${String(index)}`);
      const top20 = await hybrid.search("coverage-scope", {
        queries,
        limit: 20,
      });
      const top80 = await hybrid.search("coverage-scope", {
        queries,
        limit: 80,
      });

      expect(top20.map((hit) => hit.record.memoryId)).toEqual(
        top80.slice(0, 20).map((hit) => hit.record.memoryId),
      );
      expect(top20.filter((hit) =>
        hit.record.memoryId.startsWith("global-")
      )).toHaveLength(10);
    } finally {
      raw.close();
    }
  });

  it("keeps four explicit-date metadata candidates visible without reranking base", async () => {
    const { raw, hybrid } = await createCoverageStore();
    try {
      const hits = await hybrid.search("coverage-scope", {
        queries: ["q0 purchased item on 2023-03-15"],
        limit: 20,
      });
      const routed = hits.filter((hit) =>
        hit.matchedMetadataFilters !== undefined
      );

      expect(routed).toHaveLength(4);
      expect(routed.every((hit) =>
        hit.record.timestamp?.startsWith("2023-03-15") === true
      )).toBe(true);
      expect(hits.slice(0, 4).every((hit) =>
        hit.matchedMetadataFilters !== undefined
      )).toBe(true);
    } finally {
      raw.close();
    }
  });
});
