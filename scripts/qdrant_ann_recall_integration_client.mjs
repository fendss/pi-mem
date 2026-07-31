#!/usr/bin/env node
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { QdrantClient } from "../dist/qdrant.js";
import { deterministicQdrantPointId } from "../dist/vector-sync.js";

const [baseUrl] = process.argv.slice(2);
if (!baseUrl) {
  throw new Error("Usage: qdrant_ann_recall_integration_client.mjs URL");
}

const dimensions = 1024;
const vectorCount = 2_048;
const queryCount = 16;
const topK = 400;
const generationId = "generation-ann-recall-v1";
const profileId = "profile-ann-recall-v1";
const scopeId = "scope-ann-recall-v1";
const collection = {
  name: "pimem_ann_recall_v1",
  dimensions,
  indexingThresholdKb: 100,
  hnsw: { m: 32, efConstruct: 200, fullScanThresholdKb: 100 },
};
const client = new QdrantClient({ baseUrl, timeoutMs: 120_000 });

let state = 0x12345678;
function random() {
  state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return state / 0x1_0000_0000;
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

const vectors = Array.from({ length: vectorCount }, () =>
  normalize(Array.from({ length: dimensions }, () => random() * 2 - 1))
);

await client.health();
await client.ensureCollection(collection);
for (let offset = 0; offset < vectors.length; offset += 128) {
  const points = vectors.slice(offset, offset + 128).map((vector, localIndex) => {
    const index = offset + localIndex;
    const memoryId = `ann-memory-${index.toString().padStart(6, "0")}`;
    return {
      pointId: deterministicQdrantPointId(scopeId, memoryId, profileId),
      vector,
      generationId,
      scopeId,
      memoryId,
      sessionId: `ann-session-${Math.floor(index / 16)}`,
      role: "user",
      profileId,
      contentHash: createHash("sha256").update(memoryId).digest("hex"),
    };
  });
  await client.upsert(collection.name, dimensions, points);
}

const indexDeadline = Date.now() + 300_000;
while (true) {
  const info = await client.getCollection(collection.name);
  if (!info) throw new Error("ANN recall collection disappeared");
  if (
    info.status.toLowerCase() === "green" &&
    info.optimizerStatus.toLowerCase() === "ok" &&
    info.indexedVectorsCount >= vectorCount
  ) break;
  if (Date.now() >= indexDeadline) {
    throw new Error(
      `ANN index did not finish: ${info.indexedVectorsCount}/${vectorCount}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function dot(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index] * right[index];
  }
  return result;
}

let matched = 0;
const latencies = [];
for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
  const sourceIndex = Math.floor(queryIndex * vectorCount / queryCount);
  const query = normalize(vectors[sourceIndex].map((value) =>
    value + (random() - 0.5) * 0.01
  ));
  const exact = vectors.map((vector, index) => ({
    memoryId: `ann-memory-${index.toString().padStart(6, "0")}`,
    score: dot(query, vector),
  })).sort((left, right) => {
    const score = right.score - left.score;
    return score !== 0 ? score : left.memoryId.localeCompare(right.memoryId);
  }).slice(0, topK);
  const expected = new Set(exact.map((item) => item.memoryId));
  const started = performance.now();
  const approximate = await client.search({
    collection: collection.name,
    vector: query,
    generationId,
    scopeId,
    profileId,
    limit: topK,
    hnswEf: 800,
  });
  latencies.push(performance.now() - started);
  matched += approximate.filter((item) => expected.has(item.memoryId)).length;
}
const recall = matched / (queryCount * topK);
if (recall < 0.99) {
  throw new Error(`ANN recall gate failed: ${recall}`);
}
latencies.sort((left, right) => left - right);
const percentile = (fraction) =>
  latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];
process.stdout.write(`${JSON.stringify({
  dimensions,
  vectorCount,
  queryCount,
  topK,
  hnswEf: 800,
  recall,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
})}\n`);
