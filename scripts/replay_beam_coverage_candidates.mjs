#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { QdrantDenseRetriever } from "../dist/dense-retriever.js";
import { OpenAICompatibleEmbedder } from "../dist/embedding.js";
import { HybridMemoryStore } from "../dist/hybrid-search.js";
import { QdrantClient } from "../dist/qdrant.js";
import { AsyncRequestGate } from "../dist/request-gate.js";
import { SqliteRetrievalWorkerPool } from "../dist/sqlite-retrieval-pool.js";
import { coverageSearchHits } from "../dist/tools.js";

const [
  artifactDirectory,
  databasePath,
  qdrantUrl,
  generationId,
  collectionName,
  outputPath,
] = process.argv.slice(2);
if (!artifactDirectory || !databasePath || !qdrantUrl || !generationId || !collectionName || !outputPath) {
  throw new Error(
    "Usage: replay_beam_coverage_candidates.mjs ARTIFACT_DIR DATABASE QDRANT_URL GENERATION COLLECTION OUTPUT",
  );
}

const concurrency = Math.max(1, Math.min(32, Number(process.env.PIMEM_REPLAY_CONCURRENCY ?? 16)));
const hnswEf = Math.max(1, Number(process.env.PIMEM_QDRANT_HNSW_EF ?? 800));
const markerPattern = /\[(D\d+:\d+)\]\[text\]/gu;

function requestKey(search) {
  return JSON.stringify([
    String(search.query ?? ""),
    Array.isArray(search.options) ? search.options.map(String) : [],
    String(search.user_id ?? ""),
    Number(search.top_k ?? 0),
  ]);
}

function fingerprint(key) {
  return createHash("sha256").update(key).digest("hex");
}

function scopeId(userId) {
  return `leaderboard-${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
}

function candidateReferences(event) {
  const references = event?.details?.candidateReferences;
  return Array.isArray(references)
    ? references.map((item) => String(item.memoryId ?? "")).filter(Boolean)
    : [];
}

function markers(content) {
  return [...String(content).matchAll(markerPattern)].map((match) => match[1]);
}

async function loadBeamArtifacts(directory) {
  const selected = new Map();
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    let artifact;
    try {
      artifact = JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
    } catch {
      continue;
    }
    const search = artifact.search ?? {};
    if (artifact.status !== "ok" || !String(search.user_id ?? "").includes(":beam_")) continue;
    const key = requestKey(search);
    if (!selected.has(key)) selected.set(key, { name, artifact, search });
  }
  return [...selected.entries()].map(([key, value]) => ({ key, ...value }));
}

async function pooledMap(values, limit, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

const inputs = await loadBeamArtifacts(artifactDirectory);
if (inputs.length !== 600) {
  throw new Error(`Expected 600 unique successful BEAM artifacts, got ${inputs.length}`);
}

const sqlitePool = await SqliteRetrievalWorkerPool.create({
  databasePath,
  size: 128,
});
try {
  const embeddingGate = new AsyncRequestGate(concurrency, 10_000);
  const embedder = OpenAICompatibleEmbedder.fromEnvironment(process.env, undefined, embeddingGate);
  const qdrant = new QdrantClient({ baseUrl: qdrantUrl, timeoutMs: 120_000 });
  const denseRetriever = new QdrantDenseRetriever({
    store: sqlitePool,
    client: qdrant,
    generationId,
    collectionName,
    hnswEf,
  });
  const hybrid = new HybridMemoryStore(sqlitePool, embedder, denseRetriever);

  let completed = 0;
  const output = await pooledMap(inputs, concurrency, async ({ key, name, artifact, search }) => {
    const memory = artifact.agent.memory;
    const trace = artifact.agent.reasoning_trace;
    const originalById = new Map(memory.searched_memories.map((item) => [item.memoryId, item]));
    const retainedIds = new Set();
    const coverageEvents = [];
    for (const event of trace) {
      if (event.toolName === "search") {
        if (event?.details?.operator === "coverage") {
          coverageEvents.push(event);
        } else {
          for (const memoryId of candidateReferences(event)) retainedIds.add(memoryId);
        }
      } else if (event.toolName === "bash_ro") {
        for (const memoryId of candidateReferences(event)) retainedIds.add(memoryId);
      }
    }

    const replayById = new Map();
    for (const memoryId of retainedIds) {
      const item = originalById.get(memoryId);
      if (item) replayById.set(memoryId, item.content);
    }
    for (const event of coverageEvents) {
      const request = event.details?.request ?? {};
      const queries = Array.isArray(request.queries) ? request.queries.map(String) : [];
      if (queries.length === 0) throw new Error(`Coverage event has no queries in ${name}`);
      const hits = await coverageSearchHits(
        hybrid,
        scopeId(String(search.user_id)),
        queries,
        Math.max(60, Number(request.limit ?? 60)),
      );
      for (const hit of hits) {
        if (!replayById.has(hit.record.memoryId)) {
          replayById.set(hit.record.memoryId, hit.record.content);
        }
      }
    }

    const originalMarkers = new Set(
      memory.searched_memories.flatMap((item) => markers(item.content)),
    );
    const replayMarkers = new Set([...replayById.values()].flatMap(markers));
    completed += 1;
    if (completed % 25 === 0 || completed === inputs.length) {
      process.stderr.write(`completed=${completed}/${inputs.length}\n`);
    }
    return {
      request_fingerprint: fingerprint(key),
      artifact_file: basename(name),
      search: {
        query: search.query,
        ...(search.options === undefined ? {} : { options: search.options }),
        user_id: search.user_id,
        top_k: search.top_k,
      },
      coverage_call_count: coverageEvents.length,
      original_candidate_count: memory.searched_memories.length,
      replay_candidate_count: replayById.size,
      original_markers: [...originalMarkers].sort(),
      replay_markers: [...replayMarkers].sort(),
    };
  });

  output.sort((left, right) => left.request_fingerprint.localeCompare(right.request_fingerprint));
  await writeFile(outputPath, `${output.map((item) => JSON.stringify(item)).join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const metrics = embedder.snapshotMetrics();
  process.stdout.write(`${JSON.stringify({
    records: output.length,
    coverage_records: output.filter((item) => item.coverage_call_count > 0).length,
    embedding_calls: metrics.calls,
    embedding_latency_ms: metrics.latencyMs,
  })}\n`);
} finally {
  await sqlitePool.close();
}
