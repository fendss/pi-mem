import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLeaderboardSearchResponse,
  createLeaderboardHttpServer,
  leaderboardScopeId,
  parseLeaderboardAddRequest,
  parseLeaderboardSearchRequest,
  PiMemLeaderboardBackend,
  runSearchWithRetries,
  writeSearchAgentArtifact,
  type LeaderboardApiBackend,
} from "../src/server.js";
import { embeddingProfile } from "../src/embedding-index.js";
import type { Embedder } from "../src/embedding.js";
import type { PiModelRuntime } from "../src/model.js";
import { MemoryStore } from "../src/store.js";
import type { PiMemResult } from "../src/types.js";
import { sha256 } from "../src/util.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function requestHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function retrievalFixture(): PiMemResult {
  const first = {
    memoryId: "m-first",
    scopeId: "scope-1",
    sessionId: "session-1",
    turnIndex: 0,
    role: "user" as const,
    content: "The first immutable source fact.",
    timestamp: "2024-01-01T00:00:00.000Z",
    contentHash: "hash-first",
    metadata: {},
  };
  const second = {
    memoryId: "m-second",
    scopeId: "scope-1",
    sessionId: "session-2",
    turnIndex: 0,
    role: "assistant" as const,
    content: "The second immutable source fact.",
    contentHash: "hash-second",
    metadata: {},
  };
  const uncitedRead = {
    memoryId: "m-uncited-read",
    scopeId: "scope-1",
    sessionId: "session-3",
    turnIndex: 0,
    role: "user" as const,
    content: "Relevant-looking but uncited read evidence.",
    contentHash: "hash-uncited-read",
    metadata: {},
  };
  const remainingCandidate = {
    memoryId: "m-remaining-candidate",
    scopeId: "scope-1",
    sessionId: "session-4",
    turnIndex: 0,
    role: "assistant" as const,
    content: "A remaining navigation candidate.",
    contentHash: "hash-remaining-candidate",
    metadata: {},
  };
  return {
    runId: "run-1",
    scopeId: "scope-1",
    question: "What facts are supported?",
    status: "sufficient",
    evidenceSummary: "Two separate source facts are supported.",
    count: 2,
    inventory: [
      { item: "first", memoryIds: [first.memoryId] },
      { item: "second", memoryIds: [second.memoryId] },
    ],
    citations: [
      { memoryId: first.memoryId, supports: "The first fact." },
      { memoryId: second.memoryId, supports: "The second fact." },
    ],
    candidates: [],
    searchedMemories: [
      { ...first, discoveries: [], read: true, cited: true },
      { ...second, discoveries: [], read: true, cited: true },
      { ...uncitedRead, discoveries: [], read: true, cited: false },
      {
        ...remainingCandidate,
        discoveries: [],
        read: false,
        cited: false,
      },
    ],
    evidence: [first, second, uncitedRead],
    trace: [],
    metrics: {
      searchCalls: 1,
      readCalls: 1,
      bashCalls: 0,
      candidateCount: 4,
      evidenceCount: 3,
      citedCount: 2,
      retrievalProfile: "pimem-hybrid",
      embeddingCalls: 1,
      embeddingLatencyMs: 1,
      denseCandidateCount: 2,
      rerankCandidateCount: 2,
      expiredNavigationResults: 0,
    },
    retrieval: { retrievalProfile: "pimem-hybrid" },
    retrievalModel: {
      providerId: "provider",
      modelId: "model",
      thinkingLevel: "off",
      responseModels: ["model-2026-08-01"],
    },
  };
}

describe("leaderboard API contract", () => {
  it("returns the first protocol-valid result without rerolling insufficiency", async () => {
    const budgets: number[] = [];
    const result = await runSearchWithRetries({
      maxRunMs: 600_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      async run(attemptRunMs) {
        budgets.push(attemptRunMs);
        return { status: "insufficient" as const, citations: [], evidence: [] };
      },
    });
    expect(result.status).toBe("insufficient");
    expect(budgets).toEqual([200_000]);
  });

  it("retries only failed rollouts within the bounded budget", async () => {
    const budgets: number[] = [];
    const result = await runSearchWithRetries({
      maxRunMs: 600_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      async run(attemptRunMs, attempt) {
        budgets.push(attemptRunMs);
        if (attempt < 3) throw new Error("transient provider failure");
        return {
          status: "sufficient" as const,
          citations: [{}],
          evidence: [{}],
        };
      },
    });
    expect(result.status).toBe("sufficient");
    expect(budgets).toHaveLength(3);
    expect(budgets.every((budget) => budget > 0 && budget <= 200_000)).toBe(true);
  });

  it("stops retries immediately when the caller aborts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    await expect(runSearchWithRetries({
      maxRunMs: 60_000,
      maxAttempts: 3,
      retryDelayMs: 10_000,
      signal: controller.signal,
      async run() {
        attempts += 1;
        controller.abort();
        throw new Error("transient failure after disconnect");
      },
    })).rejects.toThrow(/aborted/u);
    expect(attempts).toBe(1);
  });

  it("validates the fixed Add and Search request schemas", () => {
    expect(parseLeaderboardAddRequest({
      request_id: "request-1",
      messages: [{ role: "user", content: "Remember this.", timestamp: 1_704_067_200_000 }],
      user_id: "user-1",
      session_id: "session-1",
    })).toMatchObject({ request_id: "request-1", user_id: "user-1" });
    expect(parseLeaderboardSearchRequest({
      query: "What should be remembered?",
      options: ["A", "B"],
      user_id: "user-1",
      top_k: 100,
    })).toMatchObject({ top_k: 100, options: ["A", "B"] });
    expect(() => parseLeaderboardAddRequest({
      request_id: "request-1",
      messages: [],
      user_id: "user-1",
      session_id: "session-1",
    })).toThrow(/messages/u);
    expect(() => parseLeaderboardSearchRequest({
      query: "question",
      user_id: "user-1",
      top_k: 0,
    })).toThrow(/top_k/u);
  });

  it("returns a deterministic evidence capsule followed by cited raw memories", () => {
    const result = retrievalFixture();
    const first = buildLeaderboardSearchResponse(result, "question", 100);
    const second = buildLeaderboardSearchResponse(result, "question", 100);

    expect(second).toEqual(first);
    expect(first.data.map((item) => item.id)).toEqual([
      expect.stringMatching(/^pimem-package-/u),
      "m-first",
      "m-second",
    ]);
    const capsule = JSON.parse(first.data[0]!.content) as Record<string, unknown>;
    expect(capsule).toMatchObject({
      type: "pimem_evidence_package_v1",
      status: "sufficient",
      evidence_summary: "Two separate source facts are supported.",
      count: 2,
    });
    expect(JSON.stringify(capsule)).toContain("The first fact.");
    expect(first.data[1]?.content).toBe("The first immutable source fact.");
    expect(first.data).toHaveLength(3);
    expect(JSON.stringify(first.data)).not.toContain("uncited read evidence");
    expect(JSON.stringify(first.data)).not.toContain("navigation candidate");
  });

  it("fails closed when a citation is absent from scoped read evidence", () => {
    const result = retrievalFixture();
    result.citations = [
      ...result.citations,
      { memoryId: "m-not-read", supports: "Unsupported source." },
    ];
    expect(() => buildLeaderboardSearchResponse(result, "question", 100))
      .toThrow(/not present in scoped read evidence/u);
  });

  it("writes a private self-contained Agent artifact without changing Search", async () => {
    const root = await mkdtemp(join(tmpdir(), "pimem-agent-artifact-"));
    temporaryPaths.push(root);
    const result = retrievalFixture();
    const request = {
      query: "question",
      user_id: "user-1",
      top_k: 100,
    };
    const response = buildLeaderboardSearchResponse(result, request.query, request.top_k);

    await writeSearchAgentArtifact(root, request, result, response);

    const path = join(root, "run-1.json");
    const artifact = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(artifact).toMatchObject({
      schema_version: "pimem-agent-search-artifact/v1",
      status: "ok",
      search: { package_id: response.data[0]?.id },
      agent: {
        run_id: "run-1",
        selection: { status: "sufficient" },
        memory: { returned_items: response.data },
      },
    });
    expect(artifact.agent.memory.read_evidence).toContainEqual(
      expect.objectContaining({ memoryId: "m-first" }),
    );
  });

  it("appends immutable chunks idempotently within one user session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pimem-leaderboard-store-"));
    temporaryPaths.push(root);
    const store = await MemoryStore.create(join(root, "memory.sqlite"));
    const scopeId = leaderboardScopeId("external-user-1");
    try {
      const firstInput = {
        requestId: "request-1",
        requestHash: requestHash("first"),
        scopeId,
        sourceSessionId: "source-session",
        messages: [
          { role: "user" as const, content: "First." },
          { role: "assistant" as const, content: "Second." },
        ],
      };
      const first = store.appendMemoryRequest(firstInput);
      expect(first.status).toBe("pending");
      expect(first.records.map((record) => record.turnIndex)).toEqual([0, 1]);
      store.markAppendRequestComplete(firstInput.requestId, firstInput.requestHash);
      expect(store.appendMemoryRequest(firstInput)).toMatchObject({
        status: "complete",
        records: first.records,
      });

      const next = store.appendMemoryRequest({
        requestId: "request-2",
        requestHash: requestHash("second"),
        scopeId,
        sourceSessionId: "source-session",
        messages: [{ role: "user", content: "Third." }],
      });
      expect(next.records[0]?.turnIndex).toBe(2);
      expect(store.listScopeRecords(scopeId)).toHaveLength(3);
      expect(() => store.appendMemoryRequest({
        ...firstInput,
        requestHash: requestHash("conflict"),
      })).toThrow(/conflict/u);
    } finally {
      store.close();
    }
  });

  it("returns Add success only after derived indexes are complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "pimem-leaderboard-add-"));
    temporaryPaths.push(root);
    const store = await MemoryStore.create(join(root, "memory.sqlite"));
    let calls = 0;
    const embedder: Embedder = {
      profileId: "test-profile",
      model: "test-embedding",
      dimensions: 2,
      maxInputLength: 2_048,
      batchSize: 10,
      async embedDocuments(texts) {
        calls += 1;
        return texts.map(() => [1, 0]);
      },
      async embedQueries(texts) {
        return texts.map(() => [1, 0]);
      },
      snapshotMetrics() {
        return { calls, latencyMs: 0 };
      },
    };
    const backend = new PiMemLeaderboardBackend({
      rawStore: store,
      embedder,
      modelRuntime: {} as PiModelRuntime,
      maxConcurrentAdds: 1,
    });
    const request = {
      request_id: "request-1",
      messages: [
        { role: "user" as const, content: "There were 3 source items." },
      ],
      user_id: "user-1",
      session_id: "session-1",
    };
    try {
      await expect(backend.add(request)).resolves.toEqual({
        success: true,
        request_id: "request-1",
        user_id: "user-1",
        session_id: "session-1",
      });
      const scopeId = leaderboardScopeId(request.user_id);
      expect(store.hasPendingAppendRequests(scopeId)).toBe(false);
      expect(store.getEmbeddingIndexStatus(scopeId, embeddingProfile(embedder)))
        .toMatchObject({ total: 1, indexed: 1, missing: 0 });
      expect(store.ensureEvidenceFactIndex(scopeId).indexedMemories).toBe(1);
      await backend.add(request);
      expect(calls).toBe(1);
    } finally {
      backend.close();
    }
  });

  it("cancels backend Search when the client disconnects", async () => {
    let started!: () => void;
    let canceled!: () => void;
    const searchStarted = new Promise<void>((resolve) => { started = resolve; });
    const searchCanceled = new Promise<void>((resolve) => { canceled = resolve; });
    const backend: LeaderboardApiBackend = {
      async add(request) {
        return {
          success: true,
          request_id: request.request_id,
          user_id: request.user_id,
          session_id: request.session_id,
        };
      },
      search(_request, signal) {
        started();
        return new Promise((_resolve, reject) => {
          const abort = (): void => {
            canceled();
            reject(new Error("backend observed disconnect"));
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const server = createLeaderboardHttpServer({ backend, authScheme: "none" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();
    try {
      const pending = fetch(`http://127.0.0.1:${port}/v1/memories/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "question",
          user_id: "user-1",
          top_k: 100,
        }),
        signal: controller.signal,
      });
      await searchStarted;
      controller.abort();
      await expect(pending).rejects.toThrow();
      await searchCanceled;
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });

  it("serves health without auth and protects Add/Search with X-Api-Key", async () => {
    const backend: LeaderboardApiBackend = {
      async add(request) {
        return {
          success: true,
          request_id: request.request_id,
          user_id: request.user_id,
          session_id: request.session_id,
        };
      },
      async search() {
        return { data: [{ id: "memory-1", content: "source" }] };
      },
    };
    const server = createLeaderboardHttpServer({
      backend,
      authScheme: "x-api-key",
      apiKey: "test-secret",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      const unauthorized = await fetch(
        `http://127.0.0.1:${port}/v1/memories/search`,
        { method: "POST", body: "{}" },
      );
      expect(unauthorized.status).toBe(401);
      const add = await fetch(`http://127.0.0.1:${port}/v1/memories/add`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "test-secret",
        },
        body: JSON.stringify({
          request_id: "request-1",
          messages: [{ role: "user", content: "memory" }],
          user_id: "user-1",
          session_id: "session-1",
        }),
      });
      expect(add.status).toBe(200);
      expect(await add.json()).toEqual({
        success: true,
        request_id: "request-1",
        user_id: "user-1",
        session_id: "session-1",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });
});
