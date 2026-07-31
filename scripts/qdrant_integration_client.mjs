#!/usr/bin/env node
import { QdrantClient } from "../dist/qdrant.js";

const [phase, baseUrl] = process.argv.slice(2);
if (!new Set(["seed", "verify"]).has(phase) || !baseUrl) {
  throw new Error("Usage: qdrant_integration_client.mjs seed|verify URL");
}

const client = new QdrantClient({ baseUrl, timeoutMs: 5_000 });
const collection = "pimem_vectors_v1";
const generationId = "generation-a";
const spec = {
  name: collection,
  dimensions: 4,
  hnsw: { m: 32, efConstruct: 200, fullScanThreshold: 1_000 },
};
const pointA = {
  pointId: "00000000-0000-4000-8000-000000000001",
  vector: [1, 0, 0, 0],
  generationId,
  scopeId: "scope-a",
  profileId: "profile-a",
  contentHash: "hash-a",
};
const pointB = {
  pointId: "00000000-0000-4000-8000-000000000002",
  vector: [0, 1, 0, 0],
  generationId,
  scopeId: "scope-b",
  profileId: "profile-a",
  contentHash: "hash-b",
};

async function waitReady() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Qdrant did not become ready", { cause: lastError });
}

async function assertIsolated(point, queryVector) {
  const hits = await client.search({
    collection,
    vector: queryVector,
    generationId,
    scopeId: point.scopeId,
    profileId: point.profileId,
    limit: 10,
    hnswEf: 256,
  });
  if (hits.length !== 1 || hits[0].pointId !== point.pointId) {
    throw new Error(
      `Scope-isolated search mismatch for ${point.scopeId}: ${JSON.stringify(hits)}`,
    );
  }
  return hits.length;
}

await waitReady();
if (phase === "seed") {
  await client.ensureCollection(spec);
  await client.ensureCollection(spec);
  await client.upsert(collection, 4, [pointA, pointB]);
  await client.upsert(collection, 4, [pointA]);
} else {
  const info = await client.getCollection(collection);
  if (!info) throw new Error("Persisted Qdrant collection is missing");
}
const scopeAHits = await assertIsolated(pointA, [1, 0, 0, 0]);
const scopeBHits = await assertIsolated(pointB, [0, 1, 0, 0]);
process.stdout.write(`${JSON.stringify({ phase, scopeAHits, scopeBHits })}\n`);
