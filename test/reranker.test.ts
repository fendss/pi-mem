import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpReranker } from "../src/reranker.js";

const MODEL = "Qwen/Qwen3-Reranker-4B";
const REVISION = "22e683669bc0f0bd69640a1354a6d0aebcfeede5";
const MANIFEST = "11159710006fbde455370d2bdd4b8d5d46620c14631d3f8c30781ee83ce4652f";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP reranker", () => {
  it("returns a complete immutable-ID score map and verifies model provenance", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return new Response(JSON.stringify({
        model: MODEL,
        revision: REVISION,
        manifest_sha256: MANIFEST,
        scores: [
          { id: "m2", score: 0.9 },
          { id: "m1", score: 0.1 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const reranker = new HttpReranker({
      baseUrl: "http://reranker.local:8090/",
      model: MODEL,
      revision: REVISION,
      manifestSha256: MANIFEST,
    });

    const scores = await reranker.rerank("query", [
      { id: "m1", text: "first" },
      { id: "m2", text: "second" },
    ]);

    expect([...scores]).toEqual([["m2", 0.9], ["m1", 0.1]]);
    expect(requests).toEqual([{
      url: "http://reranker.local:8090/v1/rerank",
      body: {
        query: "query",
        documents: [
          { id: "m1", text: "first" },
          { id: "m2", text: "second" },
        ],
      },
    }]);
  });

  it("fails closed on model substitution, missing scores, and invalid probabilities", async () => {
    const response = vi.fn();
    vi.stubGlobal("fetch", response);
    const reranker = new HttpReranker({
      baseUrl: "http://reranker.local:8090",
      model: MODEL,
      revision: REVISION,
      manifestSha256: MANIFEST,
    });
    const documents = [{ id: "m1", text: "first" }];

    response.mockResolvedValueOnce(new Response(JSON.stringify({
      model: "substituted-model",
      revision: REVISION,
      scores: [{ id: "m1", score: 0.5 }],
    }), { status: 200 }));
    await expect(reranker.rerank("query", documents)).rejects.toThrow(
      /substituted model/u,
    );

    response.mockResolvedValueOnce(new Response(JSON.stringify({
      model: MODEL,
      revision: REVISION,
      manifest_sha256: "substituted-manifest",
      scores: [{ id: "m1", score: 0.5 }],
    }), { status: 200 }));
    await expect(reranker.rerank("query", documents)).rejects.toThrow(
      /substituted manifest/u,
    );

    response.mockResolvedValueOnce(new Response(JSON.stringify({
      model: MODEL,
      revision: REVISION,
      manifest_sha256: MANIFEST,
      scores: [],
    }), { status: 200 }));
    await expect(reranker.rerank("query", documents)).rejects.toThrow(
      /score count/u,
    );

    response.mockResolvedValueOnce(new Response(JSON.stringify({
      model: MODEL,
      revision: REVISION,
      manifest_sha256: MANIFEST,
      scores: [{ id: "m1", score: 2 }],
    }), { status: 200 }));
    await expect(reranker.rerank("query", documents)).rejects.toThrow(
      /probability/u,
    );
  });
});
