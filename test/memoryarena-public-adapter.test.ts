import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryArenaMeasuredEmbedder,
  type MemoryArenaAttemptMeteredEmbedder,
} from "../src/benchmark/memoryarena-public/adapters/measured-embedder.js";
import {
  PiMemMemoryArenaAdapter,
  memoryArenaPublicScopeId,
  memoryArenaRetryableUpstreamError,
  memoryArenaUpstreamAuthStatus,
} from "../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.js";
import {
  acquireMemoryArenaPublicDataDirectoryLease,
  createMemoryArenaPublicRuntime,
} from "../src/benchmark/memoryarena-public/composition/create-runtime.js";
import { createRetrievalContext } from "../src/composition/create-retrieval-context.js";
import type { PiModelRuntime } from "../src/platform/pi/load-model-runtime.js";
import type { PiMemResult } from "../src/evidence-agent/index.js";
import { MemoryStore } from "../src/platform/sqlite/pimem-store.js";
import { OpenAICompatibleEmbedder } from "../src/retrieval/adapters/openai/openai-compatible-embedder.js";
import {
  embeddingProfile,
  type EmbeddingMetrics,
  type EmbeddingRequestOptions,
} from "../src/retrieval/index.js";

const temporaryDirectories: string[] = [];

class DeterministicEmbedder implements MemoryArenaAttemptMeteredEmbedder {
  readonly profileId = "memoryarena-test-profile";
  readonly model = "memoryarena-test-embedding";
  readonly dimensions = 2;
  readonly maxInputLength = 2048;
  readonly batchSize = 16;
  readonly inputs: string[] = [];
  private readonly attemptObserver = new AsyncLocalStorage<
    (metrics: EmbeddingMetrics) => void
  >();

  embedDocuments(
    texts: readonly string[],
    _options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    this.inputs.push(...texts);
    return Promise.resolve(texts.map((text) => [text.length, 1]));
  }

  embedQueries(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => [text.length, 1]));
  }

  snapshotMetrics(): EmbeddingMetrics {
    return { calls: this.inputs.length, latencyMs: 0 };
  }

  captureEmbeddingAttempts<T>(
    observer: (metrics: EmbeddingMetrics) => void,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.attemptObserver.run(observer, operation);
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class FailingDocumentEmbedder extends DeterministicEmbedder {
  constructor(private readonly failure: string) {
    super();
  }

  override embedDocuments(): Promise<number[][]> {
    return Promise.reject(new Error(this.failure));
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pimem-memoryarena-adapter-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("MemoryArena Public PiMem adapter", () => {
  it("appends raw chunks as independent other-role sessions and never seals", async () => {
    const directory = await temporaryDirectory();
    const store = await MemoryStore.create(join(directory, "memory.sqlite"));
    const embedder = new DeterministicEmbedder();
    const retrieval = createRetrievalContext(store, "pimem-hybrid", embedder);
    const adapter = new PiMemMemoryArenaAdapter({
      rawStore: store,
      runtimeStore: retrieval.store,
      operatorRegistry: retrieval.operatorRegistry,
      embedder,
      modelRuntime: {} as PiModelRuntime,
    });
    const scopeId = memoryArenaPublicScopeId("user", 1);
    try {
      await adapter.appendOriginalChunk({
        userId: "user",
        generation: 1,
        ordinal: 0,
        chunk: "  first exact chunk\n",
      });
      await adapter.appendOriginalChunk({
        userId: "user",
        generation: 1,
        ordinal: 1,
        chunk: "second exact chunk",
      });
      await adapter.appendOriginalChunk({
        userId: "user",
        generation: 1,
        ordinal: 0,
        chunk: "  first exact chunk\n",
      });

      const records = store.listScopeRecords(scopeId);
      expect(records).toHaveLength(2);
      expect(records.every((record) => record.role === "other")).toBe(true);
      expect(new Set(records.map((record) => record.sessionId)).size).toBe(2);
      expect(records.map((record) => record.content).sort()).toEqual([
        "  first exact chunk\n",
        "second exact chunk",
      ]);
      expect(store.hasPendingAppendRequests(scopeId)).toBe(false);
      expect(store.getOnlineScopeState(scopeId)).toBe("ingesting");
      expect(store.getEmbeddingIndexStatus(scopeId, embeddingProfile(embedder)))
        .toMatchObject({ total: 2, indexed: 2, missing: 0 });
    } finally {
      store.close();
    }
  });

  it("classifies only contextual transient upstream failures as retryable", () => {
    for (const message of [
      "HTTP 429 Too Many Requests",
      "HTTP 425 Too Early",
      "request failed with status code: 503",
      "ETIMEDOUT while reading response",
      "socket hang up",
    ]) {
      expect(memoryArenaRetryableUpstreamError(new Error(message)), message)
        .toBe(true);
    }
    for (const message of [
      "JSON parse error at position 429",
      "record UUID ends with 503",
      "HTTP 401 Unauthorized",
      "HTTP 403 Forbidden",
    ]) {
      expect(memoryArenaRetryableUpstreamError(new Error(message)), message)
        .toBe(false);
    }
  });

  it("maps HTTP 425 embedding failures to retryable upstream unavailability", async () => {
    const directory = await temporaryDirectory();
    const store = await MemoryStore.create(join(directory, "too-early.sqlite"));
    const embedder = new FailingDocumentEmbedder("HTTP 425 Too Early");
    const retrieval = createRetrievalContext(store, "pimem-hybrid", embedder);
    const adapter = new PiMemMemoryArenaAdapter({
      rawStore: store,
      runtimeStore: retrieval.store,
      operatorRegistry: retrieval.operatorRegistry,
      embedder,
      modelRuntime: {} as PiModelRuntime,
    });
    try {
      await expect(adapter.appendOriginalChunk({
        userId: "too-early",
        generation: 1,
        ordinal: 0,
        chunk: "retry this chunk",
      })).rejects.toMatchObject({
        code: "upstream_unavailable",
        httpStatus: 503,
        retryable: true,
      });
    } finally {
      store.close();
    }
  });

  it("maps contextual upstream auth failures to exact non-retryable statuses", async () => {
    expect(memoryArenaUpstreamAuthStatus(new Error("HTTP status 401"))).toBe(401);
    expect(memoryArenaUpstreamAuthStatus(new Error("error code: 403"))).toBe(403);
    expect(memoryArenaUpstreamAuthStatus(new Error("invalid API key provided")))
      .toBe(401);
    expect(memoryArenaUpstreamAuthStatus(new Error("parse error at position 401")))
      .toBeUndefined();

    const directory = await temporaryDirectory();
    const store = await MemoryStore.create(join(directory, "auth.sqlite"));
    try {
      for (const [message, expected] of [
        ["HTTP 401 Unauthorized", {
          code: "upstream_unauthorized",
          httpStatus: 401,
          retryable: false,
        }],
        ["request failed with status code: 403", {
          code: "upstream_forbidden",
          httpStatus: 403,
          retryable: false,
        }],
      ] as const) {
        const embedder = new FailingDocumentEmbedder(message);
        const retrieval = createRetrievalContext(store, "pimem-hybrid", embedder);
        const adapter = new PiMemMemoryArenaAdapter({
          rawStore: store,
          runtimeStore: retrieval.store,
          operatorRegistry: retrieval.operatorRegistry,
          embedder,
          modelRuntime: {} as PiModelRuntime,
        });
        await expect(adapter.appendOriginalChunk({
          userId: `auth-${expected.httpStatus}`,
          generation: 1,
          ordinal: 0,
          chunk: "auth failure seed",
        })).rejects.toMatchObject(expected);
      }
    } finally {
      store.close();
    }
  });

  it("attributes cross-user add and retrieval embeddings without gating the retrieval run", async () => {
    const directory = await temporaryDirectory();
    const store = await MemoryStore.create(join(directory, "concurrent.sqlite"));
    const documentStarted = deferred();
    const queryStarted = deferred();
    const documentRelease = deferred();
    const queryRelease = deferred();
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    const fetchImpl = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      const document = body.input.some((input) => input.includes("first"));
      activeFetches += 1;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      (document ? documentStarted : queryStarted).resolve();
      await (document ? documentRelease : queryRelease).promise;
      activeFetches -= 1;
      const inputTokens = document ? 11 : 23;
      return new Response(JSON.stringify({
        data: body.input.map((_input, index) => ({
          index,
          embedding: [inputTokens, 1],
        })),
        usage: { prompt_tokens: inputTokens },
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const rawEmbedder = new OpenAICompatibleEmbedder({
      baseUrl: "https://embedding.invalid/v1",
      apiKey: "test-key",
      dimensions: 2,
      maxInputLength: 2048,
      batchSize: 16,
      maxRetries: 0,
      fetchImpl,
    });
    const embedder = new MemoryArenaMeasuredEmbedder(rawEmbedder);
    const retrieval = createRetrievalContext(store, "pimem-hybrid", embedder);
    const retrievalStarted = deferred();
    const adapter = new PiMemMemoryArenaAdapter({
      rawStore: store,
      runtimeStore: retrieval.store,
      operatorRegistry: retrieval.operatorRegistry,
      embedder,
      modelRuntime: {} as PiModelRuntime,
      runPiMemImpl: async (options) => {
        retrievalStarted.resolve();
        await embedder.embedQueries([options.question]);
        return {
          runId: "retrieval-not-gated",
          scopeId: options.scopeId,
          question: options.question,
          status: "insufficient",
          citations: [],
          evidenceSummary: "",
          candidates: [],
          evidence: [],
          trace: [],
          metrics: {},
          retrieval: {},
          retrievalModel: {},
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        } as unknown as PiMemResult;
      },
    });
    try {
      const add = embedder.measureOperation(() => adapter.appendOriginalChunk({
        userId: "parallel-a",
        generation: 1,
        ordinal: 0,
        chunk: "first",
      }));
      await documentStarted.promise;
      const retrieve = embedder.measureOperation(() => adapter.retrieve({
        userId: "parallel-b",
        generation: 1,
        question: "Can retrieval pass the append gate?",
      }));
      await retrievalStarted.promise;
      await queryStarted.promise;
      expect(maximumActiveFetches).toBe(2);

      documentRelease.resolve();
      queryRelease.resolve();
      const [addResult, retrieveResult] = await Promise.all([add, retrieve]);

      expect(retrieveResult.result).toMatchObject({ runId: "retrieval-not-gated" });
      expect(addResult.embedding).toMatchObject({
        measurement: "async_context",
        delta: { calls: 1, inputTokens: 11, usageMissingCalls: 0 },
      });
      expect(retrieveResult.embedding).toMatchObject({
        measurement: "async_context",
        delta: { calls: 1, inputTokens: 23, usageMissingCalls: 0 },
      });
      expect(rawEmbedder.snapshotMetrics()).toMatchObject({
        calls: 2,
        inputTokens: 34,
        usageMissingCalls: 0,
      });
    } finally {
      documentRelease.resolve();
      queryRelease.resolve();
      store.close();
    }
  });

  it("refuses a second live process owner for one data directory", async () => {
    const directory = await temporaryDirectory();
    const first = await acquireMemoryArenaPublicDataDirectoryLease(directory);
    try {
      await expect(acquireMemoryArenaPublicDataDirectoryLease(directory))
        .rejects.toThrow("already owned by process");
    } finally {
      await first.release();
    }
    const reacquired = await acquireMemoryArenaPublicDataDirectoryLease(directory);
    await reacquired.release();
  });

  it("exposes and closes the default durable operation audit", async () => {
    const directory = await temporaryDirectory();
    const runtime = await createMemoryArenaPublicRuntime({
      dataDir: directory,
      modelRuntime: {} as PiModelRuntime,
      embedder: new DeterministicEmbedder(),
    });
    try {
      expect(runtime.paths.operationAudits).toBe(
        join(directory, "operation-audits.jsonl"),
      );
      await runtime.backend.initialize({
        userId: "runtime-user",
        memorySystemName: "pimem",
      });
    } finally {
      await runtime.close();
    }

    const records = (await readFile(runtime.paths.operationAudits, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.phase)).toEqual([
      "start",
      "success",
    ]);
    expect(records[1]).toMatchObject({
      operation: "initialize",
      user_id: "runtime-user",
      generation: 1,
    });
  });
});
