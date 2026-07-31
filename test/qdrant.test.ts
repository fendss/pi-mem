import { describe, expect, it, vi } from "vitest";
import {
  QdrantClient,
  QdrantHttpError,
  type QdrantCollectionSpec,
} from "../src/qdrant.js";

const SPEC: QdrantCollectionSpec = {
  name: "pimem_vectors_v1",
  dimensions: 2,
  hnsw: { m: 32, efConstruct: 200, fullScanThreshold: 1_000 },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function collectionResponse(overrides: {
  dimensions?: number;
  distance?: string;
  m?: number;
} = {}): Response {
  return jsonResponse({
    result: {
      status: "green",
      optimizer_status: "ok",
      points_count: 0,
      indexed_vectors_count: 0,
      config: {
        params: {
          vectors: {
            size: overrides.dimensions ?? SPEC.dimensions,
            distance: overrides.distance ?? "Cosine",
          },
        },
        hnsw_config: {
          m: overrides.m ?? SPEC.hnsw.m,
          ef_construct: SPEC.hnsw.efConstruct,
          full_scan_threshold: SPEC.hnsw.fullScanThreshold,
        },
      },
    },
    status: "ok",
  });
}

function client(fetchImpl: typeof fetch): QdrantClient {
  return new QdrantClient({
    baseUrl: "http://qdrant.internal:6333/",
    timeoutMs: 5_000,
    fetchImpl,
  });
}

describe("Qdrant server client", () => {
  it("rejects unsafe endpoints and collection names", async () => {
    expect(() => new QdrantClient({ baseUrl: "file:///tmp/qdrant" }))
      .toThrow(/HTTP or HTTPS/u);
    expect(() => new QdrantClient({ baseUrl: "http://user:secret@localhost" }))
      .toThrow(/credentials/u);

    const fetchImpl = vi.fn<typeof fetch>();
    await expect(client(fetchImpl).getCollection("../other"))
      .rejects.toThrow(/collection name/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a collection and mandatory tenant/profile payload indexes", async () => {
    const responses = [
      jsonResponse({ status: "not found" }, 404),
      jsonResponse({ result: true, status: "ok" }),
      collectionResponse(),
      jsonResponse({ result: { operation_id: 1 }, status: "ok" }),
      jsonResponse({ result: { operation_id: 2 }, status: "ok" }),
      jsonResponse({ result: { operation_id: 3 }, status: "ok" }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);

    await client(fetchImpl).ensureCollection(SPEC);

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const create = fetchImpl.mock.calls[1]!;
    expect(String(create[0])).toBe(
      "http://qdrant.internal:6333/collections/pimem_vectors_v1",
    );
    expect(JSON.parse(String(create[1]?.body))).toEqual({
      vectors: { size: 2, distance: "Cosine" },
      hnsw_config: {
        m: 32,
        ef_construct: 200,
        full_scan_threshold: 1_000,
      },
      on_disk_payload: false,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[3]?.[1]?.body))).toEqual({
      field_name: "scope_id",
      field_schema: { type: "keyword", is_tenant: true },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[4]?.[1]?.body))).toEqual({
      field_name: "profile_id",
      field_schema: { type: "keyword" },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[5]?.[1]?.body))).toEqual({
      field_name: "generation_id",
      field_schema: { type: "keyword" },
    });
  });

  it("fails closed when an existing collection has incompatible vectors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      collectionResponse({ dimensions: 3 })
    );
    await expect(client(fetchImpl).ensureCollection(SPEC))
      .rejects.toThrow(/configuration mismatch/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends minimal provenance and mandatory scope filters", async () => {
    const responses = [
      jsonResponse({ result: { operation_id: 1 }, status: "ok" }),
      jsonResponse({
        result: [{
          id: "00000000-0000-4000-8000-000000000001",
          score: 0.91,
          payload: {
            generation_id: "generation-a",
            scope_id: "scope-a",
            profile_id: "profile-a",
            content_hash: "hash-a",
          },
        }],
        status: "ok",
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const qdrant = client(fetchImpl);

    await qdrant.upsert(SPEC.name, 2, [{
      pointId: "00000000-0000-4000-8000-000000000001",
      vector: [1, 0],
      generationId: "generation-a",
      scopeId: "scope-a",
      profileId: "profile-a",
      contentHash: "hash-a",
    }]);
    const hits = await qdrant.search({
      collection: SPEC.name,
      vector: [1, 0],
      generationId: "generation-a",
      scopeId: "scope-a",
      profileId: "profile-a",
      limit: 20,
      hnswEf: 256,
    });

    const upsert = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(upsert.points[0]).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      vector: [1, 0],
      payload: {
        generation_id: "generation-a",
        scope_id: "scope-a",
        profile_id: "profile-a",
        content_hash: "hash-a",
        schema_version: 1,
      },
    });
    expect(upsert.points[0].payload).not.toHaveProperty("content");

    const search = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(search.filter.must).toEqual([
      { key: "generation_id", match: { value: "generation-a" } },
      { key: "scope_id", match: { value: "scope-a" } },
      { key: "profile_id", match: { value: "profile-a" } },
    ]);
    expect(hits).toEqual([{
      pointId: "00000000-0000-4000-8000-000000000001",
      score: 0.91,
      generationId: "generation-a",
      scopeId: "scope-a",
      profileId: "profile-a",
      contentHash: "hash-a",
    }]);
  });

  it("uses exact generation/profile/scope filters when counting points", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      result: { count: 7 },
      status: "ok",
    }));
    const count = await client(fetchImpl).count({
      collection: SPEC.name,
      generationId: "generation-a",
      profileId: "profile-a",
      scopeId: "scope-a",
    });
    expect(count).toBe(7);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      filter: {
        must: [
          { key: "generation_id", match: { value: "generation-a" } },
          { key: "profile_id", match: { value: "profile-a" } },
          { key: "scope_id", match: { value: "scope-a" } },
        ],
      },
      exact: true,
    });
  });

  it("rejects a server result outside the requested scope", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      result: [{
        id: "00000000-0000-4000-8000-000000000002",
        score: 0.9,
        payload: {
          generation_id: "generation-a",
          scope_id: "scope-b",
          profile_id: "profile-a",
          content_hash: "hash-b",
        },
      }],
      status: "ok",
    }));
    await expect(client(fetchImpl).search({
      collection: SPEC.name,
      vector: [1, 0],
      generationId: "generation-a",
      scopeId: "scope-a",
      profileId: "profile-a",
      limit: 20,
      hnswEf: 256,
    })).rejects.toThrow(/outside the mandatory scope/u);
  });

  it("surfaces authentication and authorization failures without masking them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "forbidden" }, 403)
    );
    const pending = client(fetchImpl).health();
    await expect(pending).rejects.toBeInstanceOf(QdrantHttpError);
    await expect(pending).rejects.toMatchObject({ status: 403 });
  });
});
