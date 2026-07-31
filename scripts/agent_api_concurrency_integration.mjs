#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { QdrantDenseRetriever } from "../dist/dense-retriever.js";
import { ingestMemorySessions } from "../dist/ingest.js";
import { createPiModelRuntime } from "../dist/model.js";
import { QdrantClient } from "../dist/qdrant.js";
import {
  createLeaderboardHttpServer,
  leaderboardScopeId,
  PiMemLeaderboardBackend,
} from "../dist/server.js";
import { SqliteRetrievalWorkerPool } from "../dist/sqlite-retrieval-pool.js";
import { MemoryStore } from "../dist/store.js";
import { QdrantVectorSynchronizer } from "../dist/vector-sync.js";

const [qdrantUrl, databasePath = "/data/memory.sqlite"] = process.argv.slice(2);
if (!qdrantUrl) throw new Error("Qdrant URL is required");
for (const suffix of ["", "-wal", "-shm"]) {
  await rm(`${databasePath}${suffix}`, { force: true });
}

const dimensions = 1024;
const memoryCount = 512;
const userId = "agent-load-user";
const scopeId = leaderboardScopeId(userId);
const generationId = "agent-load-generation-v1";
const profile = {
  profileId: "agent-load-profile-v1",
  model: "deterministic-agent-load-embedding",
  dimensions,
};
const collection = {
  name: "pimem_agent_load_v1",
  dimensions,
  indexingThresholdKb: 100,
  hnsw: { m: 32, efConstruct: 200, fullScanThresholdKb: 100 },
};

let randomState = 0x128a9e37;
function random() {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return randomState / 0x1_0000_0000;
}
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}
const vectors = Array.from({ length: memoryCount }, () =>
  normalize(Array.from({ length: dimensions }, () => random() * 2 - 1))
);

const writer = await MemoryStore.create(databasePath);
await ingestMemorySessions(writer, [{
  scopeId,
  sessionId: "agent-load-session",
  turns: Array.from({ length: memoryCount }, (_, index) => ({
    id: `agent-memory-${index.toString().padStart(6, "0")}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `marker${index} immutable agent load memory ${index}`,
  })),
}]);
writer.beginVectorIndexGeneration({
  generationId,
  collectionName: collection.name,
  profile,
});
const records = writer.listScopeRecords(scopeId);
writer.storeEmbeddingBatchForVectorGeneration(
  generationId,
  records,
  profile,
  vectors,
);
const qdrant = new QdrantClient({ baseUrl: qdrantUrl, timeoutMs: 120_000 });
const synchronizer = new QdrantVectorSynchronizer({
  store: writer,
  client: qdrant,
  generationId,
  collection,
  batchSize: 128,
  concurrentBatches: 8,
  verificationPollMs: 100,
  verificationTimeoutMs: 300_000,
});
await synchronizer.finalize();
const sqlitePool = await SqliteRetrievalWorkerPool.create({
  databasePath,
  size: 128,
});

const embedder = {
  profileId: profile.profileId,
  model: profile.model,
  dimensions,
  maxInputLength: 2_048,
  batchSize: 128,
  embedDocuments: async (texts) => texts.map(() => vectors[0]),
  embedQueries: async (texts) => texts.map((text) => {
    const match = text.match(/marker(\d+)/u);
    return vectors[Number(match?.[1] ?? 0) % vectors.length];
  }),
  snapshotMetrics: () => ({ calls: 0, latencyMs: 0 }),
};
const denseRetriever = new QdrantDenseRetriever({
  store: sqlitePool,
  client: qdrant,
  generationId,
  collectionName: collection.name,
  hnswEf: 800,
});

let toolCallSequence = 0;
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const baseRuntime = createPiModelRuntime({
  providerId: "deterministic-provider",
  modelId: "deterministic-agent",
  baseUrl: "http://127.0.0.1:1/v1",
  apiKeyEnv: "PIMEM_UNUSED_TEST_KEY",
  thinkingLevel: "off",
});
const streamFn = (model, context) => {
  const last = context.messages[context.messages.length - 1];
  let name;
  let args;
  if (last?.role === "toolResult" && last.toolName === "search") {
    name = "read";
    args = { candidateRefs: [1], contextBefore: 0, contextAfter: 0 };
  } else if (last?.role === "toolResult" && last.toolName === "read") {
    name = "finish";
    args = {
      status: "sufficient",
      citations: [{ candidateRef: 1, supports: "Selected immutable source memory." }],
      evidenceSummary: "Selected immutable source memory.",
    };
  } else {
    const text = last?.role === "user"
      ? (typeof last.content === "string" ? last.content : JSON.stringify(last.content))
      : "";
    const marker = text.match(/marker\d+/u)?.[0] ?? "marker0";
    name = "search";
    args = { operator: "hybrid", queries: [marker], limit: 100 };
  }
  toolCallSequence += 1;
  const message = {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: `deterministic-tool-${toolCallSequence}`,
      name,
      arguments: args,
    }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage,
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
  });
  return stream;
};
const modelRuntime = {
  ...baseRuntime,
  streamFn,
  getApiKey: async () => "unused",
};
const backend = new PiMemLeaderboardBackend({
  rawStore: writer,
  retrievalStore: sqlitePool,
  embedder,
  denseRetriever,
  vectorSynchronizer: synchronizer,
  vectorGenerationId: generationId,
  modelRuntime,
  maxConcurrentSearches: 128,
  maxRunMs: 120_000,
  searchAttempts: 1,
});
const server = createLeaderboardHttpServer({ backend, authScheme: "none" });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Agent API has no port");
const endpoint = `http://127.0.0.1:${address.port}/v1/memories/search`;

async function runLevel(concurrency) {
  const total = concurrency === 128 ? 128 : 32;
  let next = 0;
  const latencies = [];
  const errors = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= total) return;
      const marker = index % memoryCount;
      const started = performance.now();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `Find marker${marker}`,
            user_id: userId,
            top_k: 10,
          }),
        });
        const body = await response.json();
        const capsule = body.data?.[0] ? JSON.parse(body.data[0].content) : undefined;
        if (
          response.status !== 200 ||
          capsule?.type !== "pimem_evidence_package_v1" ||
          capsule?.status !== "sufficient" ||
          body.data.length < 2
        ) {
          throw new Error(`Invalid Agent response: ${JSON.stringify(body)}`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        latencies.push(performance.now() - started);
      }
    }
  });
  await Promise.all(workers);
  latencies.sort((left, right) => left - right);
  const percentile = (fraction) =>
    latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
  return {
    concurrency,
    requests: total,
    errors: errors.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: latencies[latencies.length - 1],
    ...(errors.length === 0 ? {} : { firstError: errors[0] }),
  };
}

try {
  const levels = [];
  for (const concurrency of [1, 16, 32, 64, 128]) {
    const level = await runLevel(concurrency);
    levels.push(level);
    if (level.errors !== 0) {
      throw new Error(`Agent concurrency ${concurrency} failed: ${level.firstError}`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    deterministicModel: true,
    agentProtocol: ["search", "read", "finish"],
    sqliteWorkers: 128,
    dimensions,
    vectors: memoryCount,
    levels,
  }, null, 2)}\n`);
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
  await backend.close();
}
