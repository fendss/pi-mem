#!/usr/bin/env node
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { QdrantDenseRetriever } from "../dist/dense-retriever.js";
import { HybridMemoryStore } from "../dist/hybrid-search.js";
import { ingestMemorySessions } from "../dist/ingest.js";
import { QdrantClient } from "../dist/qdrant.js";
import { SqliteRetrievalWorkerPool } from "../dist/sqlite-retrieval-pool.js";
import { MemoryStore } from "../dist/store.js";
import { QdrantVectorSynchronizer } from "../dist/vector-sync.js";

const [qdrantUrl, databasePath = "/state/memory.sqlite"] = process.argv.slice(2);
if (!qdrantUrl) {
  throw new Error("Usage: retrieval_concurrency_integration.mjs QDRANT_URL DATABASE");
}
for (const suffix of ["", "-wal", "-shm"]) {
  await rm(`${databasePath}${suffix}`, { force: true });
}

const dimensions = 1024;
const vectorCount = 2_048;
const scopeId = "concurrency-scope";
const generationId = "concurrency-generation-v1";
const profile = {
  profileId: "concurrency-profile-v1",
  model: "deterministic-load-embedding",
  dimensions,
};
const collection = {
  name: "pimem_concurrency_v1",
  dimensions,
  indexingThresholdKb: 100,
  hnsw: { m: 32, efConstruct: 200, fullScanThresholdKb: 100 },
};

let randomState = 0x5eed1234;
function random() {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return randomState / 0x1_0000_0000;
}
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}
const vectors = Array.from({ length: vectorCount }, () =>
  normalize(Array.from({ length: dimensions }, () => random() * 2 - 1))
);

const writer = await MemoryStore.create(databasePath);
await ingestMemorySessions(writer, [{
  scopeId,
  sessionId: "concurrency-session",
  turns: Array.from({ length: vectorCount }, (_, index) => ({
    id: `concurrency-memory-${index.toString().padStart(6, "0")}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `marker${index} immutable semantic memory ${index}`,
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
    const match = text.match(/^marker(\d+)$/u);
    if (!match) throw new Error(`Unexpected load query: ${text}`);
    return vectors[Number(match[1]) % vectors.length];
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
const hybrid = new HybridMemoryStore(sqlitePool, embedder, denseRetriever);

const server = createServer(async (request, response) => {
  const abort = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) abort.abort();
  });
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const hits = await hybrid.search(scopeId, {
      queries: [input.query],
      limit: 100,
    }, abort.signal);
    const body = JSON.stringify({
      ids: hits.map((hit) => hit.record.memoryId),
      profile: hybrid.getRetrievalMetadata().retrievalProfile,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  } catch (error) {
    if (response.destroyed) return;
    const body = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    response.writeHead(503, { "content-type": "application/json" });
    response.end(body);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Load server has no port");
const endpoint = `http://127.0.0.1:${address.port}`;

async function runLevel(concurrency) {
  const total = 128;
  let next = 0;
  const latencies = [];
  const errors = [];
  let heartbeats = 0;
  const heartbeat = setInterval(() => { heartbeats += 1; }, 2);
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= total) return;
      const queryIndex = index % vectorCount;
      const started = performance.now();
      try {
        const result = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: `marker${queryIndex}` }),
        });
        const body = await result.json();
        if (
          result.status !== 200 ||
          body.profile !== "pimem-hybrid-qdrant-hnsw-v1" ||
          body.ids.length !== 100 ||
          !body.ids.includes(
            `concurrency-memory-${queryIndex.toString().padStart(6, "0")}`,
          )
        ) {
          throw new Error(`Invalid retrieval response: ${JSON.stringify(body)}`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        latencies.push(performance.now() - started);
      }
    }
  });
  await Promise.all(workers);
  clearInterval(heartbeat);
  latencies.sort((left, right) => left - right);
  const percentile = (fraction) =>
    latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
  return {
    concurrency,
    requests: total,
    errors: errors.length,
    heartbeats,
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
      throw new Error(`Concurrency ${concurrency} produced ${level.errors} errors`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    dimensions,
    vectors: vectorCount,
    sqliteWorkers: 128,
    hnswEf: 800,
    levels,
  }, null, 2)}\n`);
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
  await sqlitePool.close();
  writer.close();
}
