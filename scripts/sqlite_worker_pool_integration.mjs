#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { ingestMemorySessions } from "../dist/ingest.js";
import { SqliteRetrievalWorkerPool } from "../dist/sqlite-retrieval-pool.js";
import { MemoryStore } from "../dist/store.js";

const databasePath = process.argv[2] ?? "/state/memory.sqlite";
const workerCount = 128;
const scopeCount = 128;
const turnsPerScope = 100;
for (const suffix of ["", "-wal", "-shm"]) {
  await rm(`${databasePath}${suffix}`, { force: true });
}

const writer = await MemoryStore.create(databasePath);
const sessions = Array.from({ length: scopeCount }, (_, scopeIndex) => ({
  scopeId: `scope-${scopeIndex}`,
  sessionId: `session-${scopeIndex}`,
  timestamp: `2024-01-${String(scopeIndex % 28 + 1).padStart(2, "0")}T00:00:00.000Z`,
  turns: Array.from({ length: turnsPerScope }, (_, turnIndex) => ({
    id: `memory-${scopeIndex}-${turnIndex}`,
    role: turnIndex % 2 === 0 ? "user" : "assistant",
    content: `marker${scopeIndex} shared lexical memory turn ${turnIndex}`,
  })),
}));
await ingestMemorySessions(writer, sessions);
for (let scopeIndex = 0; scopeIndex < scopeCount; scopeIndex += 1) {
  writer.ensureEvidenceFactIndex(`scope-${scopeIndex}`);
}
const profile = {
  profileId: "worker-profile",
  model: "worker-embedding",
  dimensions: 2,
};
writer.beginVectorIndexGeneration({
  generationId: "worker-generation",
  collectionName: "worker_collection",
  profile,
});
const firstScope = writer.listScopeRecords("scope-0");
writer.storeEmbeddingBatchForVectorGeneration(
  "worker-generation",
  firstScope,
  profile,
  firstScope.map((_, index) => [1, index / turnsPerScope]),
);
writer.sealVectorIndexGeneration("worker-generation");
const claims = writer.claimVectorSyncBatch(
  "worker-generation",
  turnsPerScope,
  60_000,
);
writer.completeVectorSyncBatch(
  "worker-generation",
  claims.map((claim) => claim.sequenceId),
);
writer.beginVectorIndexVerification("worker-generation");
writer.markVectorIndexGenerationReady("worker-generation", turnsPerScope);
writer.close();

const startupStarted = performance.now();
const pool = await SqliteRetrievalWorkerPool.create({
  databasePath,
  size: workerCount,
});
const startupMs = performance.now() - startupStarted;
let heartbeatCount = 0;
let maximumHeartbeatDelayMs = 0;
let previousHeartbeat = performance.now();
const heartbeat = setInterval(() => {
  const now = performance.now();
  maximumHeartbeatDelayMs = Math.max(
    maximumHeartbeatDelayMs,
    now - previousHeartbeat - 2,
  );
  previousHeartbeat = now;
  heartbeatCount += 1;
}, 2);

try {
  const latencies = [];
  const searches = Array.from({ length: scopeCount }, async (_, scopeIndex) => {
    const started = performance.now();
    const hits = await pool.search(`scope-${scopeIndex}`, {
      queries: [`marker${scopeIndex}`],
      limit: 5,
    });
    latencies.push(performance.now() - started);
    if (
      hits.length !== 5 ||
      hits.some((hit) => hit.record.scopeId !== `scope-${scopeIndex}`)
    ) {
      throw new Error(`Worker scope isolation failed for scope-${scopeIndex}`);
    }
    return hits;
  });
  const activeAtDispatch = pool.activeCount;
  const results = await Promise.all(searches);
  clearInterval(heartbeat);

  const generation = await pool.assertVectorIndexGenerationReady(
    "worker-generation",
  );
  const embedding = await pool.getEmbeddingIndexStatus("scope-0", profile);
  const records = await pool.getRecords(
    "scope-0",
    results[0].map((hit) => hit.record.memoryId),
  );
  const expanded = await pool.expandEvidenceOperator(
    "scope-0",
    { queries: ["2024-01-01 marker0"], limit: 10 },
    { operator: "temporal", maxCandidates: 10 },
    results[0],
  );
  const aborted = new AbortController();
  const canceledSearch = pool.search(
    "scope-0",
    { queries: ["marker0"] },
    aborted.signal,
  );
  aborted.abort();
  let cancellation = "failed";
  try {
    await canceledSearch;
  } catch (error) {
    if (error instanceof Error && /aborted/u.test(error.message)) {
      cancellation = "ok";
    } else {
      throw error;
    }
  }
  if (!(await pool.hasScopeRecords("scope-0"))) {
    throw new Error("SQLite worker pool did not recover after cancellation");
  }

  if (
    activeAtDispatch !== workerCount ||
    heartbeatCount === 0 ||
    generation.state !== "ready" ||
    embedding.missing !== 0 ||
    records.length !== 5 ||
    expanded.length === 0 ||
    cancellation !== "ok"
  ) {
    throw new Error("SQLite worker-pool integration invariant failed");
  }
  latencies.sort((left, right) => left - right);
  const percentile = (fraction) =>
    latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
  process.stdout.write(`${JSON.stringify({
    workers: workerCount,
    scopes: scopeCount,
    memories: scopeCount * turnsPerScope,
    startupMs,
    activeAtDispatch,
    heartbeatCount,
    maximumHeartbeatDelayMs,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    scopeIsolation: "ok",
    generationBarrier: generation.state,
    readOnlyFactExpansion: "ok",
    cancellation,
  }, null, 2)}\n`);
} finally {
  clearInterval(heartbeat);
  await pool.close();
}
