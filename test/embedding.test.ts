import { describe, expect, it, vi } from "vitest";
import {
  chunkTextBalanced,
  cleanEmbeddingText,
  OpenAICompatibleEmbedder,
} from "../src/embedding.js";
import { AsyncRequestGate } from "../src/request-gate.js";

function responseFor(
  inputs: readonly string[],
  dimensions: number,
  reverse = false,
): Response {
  const data = inputs.map((input, index) => ({
    index,
    embedding: Array.from({ length: dimensions }, (_, dimension) =>
      dimension === 0 ? [...input].length : index + dimension,
    ),
  }));
  return new Response(JSON.stringify({ data: reverse ? data.reverse() : data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockEmbedder(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof OpenAICompatibleEmbedder>[0]> = {},
): OpenAICompatibleEmbedder {
  return new OpenAICompatibleEmbedder({
    baseUrl: "https://embedding.invalid/v1",
    apiKey: "test-secret-key",
    model: "text-embedding-v4",
    dimensions: 2,
    maxInputLength: 4,
    batchSize: 32,
    fetchImpl,
    ...overrides,
  });
}

describe("OpenAI-compatible embedding boundary", () => {
  it("removes OpenAI special tokens and replaces empty text", () => {
    expect(cleanEmbeddingText("a<|im_start|>b<|endoftext|>")).toBe("ab");
    expect(cleanEmbeddingText("<|fim_prefix|><|fim_suffix|>")).toBe(".");
  });

  it("balances chunks by Unicode code point rather than UTF-16 unit", () => {
    expect(chunkTextBalanced("😀12345678", 4)).toEqual(["😀12", "345", "678"]);
    expect(chunkTextBalanced("abcdefghij", 4).map((chunk) => chunk.length))
      .toEqual([4, 4, 2]);
  });

  it("restores response index order and averages chunk vectors", async () => {
    const requests: string[][] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      requests.push(body.input);
      return responseFor(body.input, 2, true);
    }) as unknown as typeof fetch;
    const embedder = mockEmbedder(fetchImpl);

    const vectors = await embedder.embedDocuments(["abcdefghij", "xy"]);

    expect(requests).toEqual([["abcd", "efgh", "ij", "xy"]]);
    expect(vectors[0]?.[0]).toBeCloseTo((4 + 4 + 2) / 3);
    expect(vectors[0]?.[1]).toBeCloseTo((1 + 2 + 3) / 3);
    expect(vectors[1]).toEqual([2, 4]);
    expect(embedder.snapshotMetrics().calls).toBe(1);
  });

  it("shares a global request gate across embedder instances", async () => {
    let active = 0;
    let maximum = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return responseFor(body.input, 2);
    }) as unknown as typeof fetch;
    const requestGate = new AsyncRequestGate(1, 10_000);
    const first = mockEmbedder(fetchImpl, { requestGate });
    const second = mockEmbedder(fetchImpl, { requestGate });

    await Promise.all([
      first.embedDocuments(["first"]),
      second.embedDocuments(["second"]),
    ]);

    expect(maximum).toBe(1);
  });

  it("retries once without dimensions after a compatible 400 response", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "dimensions is unsupported" } }),
          { status: 400 },
        );
      }
      return responseFor(body.input as string[], 2);
    }) as unknown as typeof fetch;
    const embedder = mockEmbedder(fetchImpl);

    await expect(embedder.embedQueries(["query"])).resolves.toHaveLength(1);
    expect(bodies[0]).toHaveProperty("dimensions", 2);
    expect(bodies[1]).not.toHaveProperty("dimensions");
    expect(embedder.snapshotMetrics().calls).toBe(2);
  });

  it("retries unrelated bad requests indefinitely without removing dimensions", async () => {
    vi.useFakeTimers();
    try {
      const bodies: Array<Record<string, unknown>> = [];
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (bodies.length <= 2) {
          return new Response(
            JSON.stringify({ error: { message: "input batch is too large" } }),
            { status: 400 },
          );
        }
        return responseFor(body.input as string[], 2);
      }) as unknown as typeof fetch;
      const embedder = mockEmbedder(fetchImpl);

      const pending = embedder.embedQueries(["query"]);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toHaveLength(1);
      expect(bodies).toHaveLength(3);
      expect(bodies.every((body) => body.dimensions === 2)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast on embedding authentication and authorization errors", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () =>
        new Response("credential rejected", { status })
      ) as unknown as typeof fetch;
      const embedder = mockEmbedder(fetchImpl);

      await expect(embedder.embedQueries(["query"])).rejects.toThrow(
        `HTTP ${status}`,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("backs off through rate limits indefinitely", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (calls <= 3) return new Response("rate limited", { status: 429 });
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return responseFor(body.input, 2);
      }) as unknown as typeof fetch;
      const requestGate = new AsyncRequestGate(1, 10_000);
      const gatedCalls = vi.spyOn(requestGate, "run");
      const embedder = mockEmbedder(fetchImpl, { requestGate });

      const pending = embedder.embedDocuments(["query"]);
      await vi.advanceTimersByTimeAsync(7_000);
      await expect(pending).resolves.toHaveLength(1);
      expect(calls).toBe(4);
      expect(gatedCalls).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries transient transport failures indefinitely", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (calls <= 3) throw new TypeError("temporary connection failure");
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return responseFor(body.input, 2);
      }) as unknown as typeof fetch;
      const embedder = mockEmbedder(fetchImpl);

      const pending = embedder.embedQueries(["query"]);
      await vi.advanceTimersByTimeAsync(7_000);
      await expect(pending).resolves.toHaveLength(1);
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries wrong dimensions, non-finite values, and duplicate indexes", async () => {
    vi.useFakeTimers();
    try {
      const expectRetry = async (
        firstResponse: unknown,
        inputs: string[],
      ): Promise<void> => {
        let calls = 0;
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
          calls += 1;
          if (calls === 1) return firstResponse as Response;
          const body = JSON.parse(String(init?.body)) as { input: string[] };
          return responseFor(body.input, 2);
        }) as unknown as typeof fetch;
        const pending = mockEmbedder(fetchImpl).embedDocuments(inputs);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toHaveLength(inputs.length);
        expect(calls).toBe(2);
      };

      await expectRetry(responseFor(["x"], 1), ["x"]);
      await expectRetry({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ index: 0, embedding: [0, Number.NaN] }] }),
      }, ["x"]);
      await expectRetry(new Response(JSON.stringify({
        data: [
          { index: 0, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }), { status: 200 }), ["x", "y"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed without credentials and never includes the key in errors", async () => {
    expect(() => OpenAICompatibleEmbedder.fromEnvironment({
      PIMEM_EMBEDDING_BASE_URL: "https://embedding.invalid/v1",
    })).toThrow(/API_KEY is required/u);
    expect(OpenAICompatibleEmbedder.fromEnvironment({
      PIMEM_EMBEDDING_BASE_URL: "https://embedding.invalid/v1",
      PIMEM_EMBEDDING_API_KEY: "configured",
    }, vi.fn() as unknown as typeof fetch).batchSize).toBe(10);

    const secret = "never-echo-this-secret";
    let calls = 0;
    const embedder = mockEmbedder(
      vi.fn(async () => {
        calls += 1;
        throw new Error(`upstream accidentally echoed ${secret}`);
      }) as unknown as typeof fetch,
      { apiKey: secret },
    );
    const controller = new AbortController();
    const pending = embedder.embedQueries(["query"], { signal: controller.signal });
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    controller.abort();
    let message = "";
    try {
      await pending;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/aborted/u);
    expect(message).not.toContain(secret);
    expect(embedder.profileId).not.toContain("embedding.invalid");
    expect(embedder.profileId).not.toContain(secret);
  });

  it("sends the key only as an Authorization header", async () => {
    const observed: {
      authorization: string | undefined;
      body: string | undefined;
    } = { authorization: undefined, body: undefined };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      observed.authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      observed.body = String(init?.body);
      const body = JSON.parse(observed.body) as { input: string[] };
      return responseFor(body.input, 2);
    }) as unknown as typeof fetch;
    const embedder = mockEmbedder(fetchImpl);

    await embedder.embedDocuments(["<|im_end|>"]);

    expect(observed.authorization).toBe("Bearer test-secret-key");
    expect(observed.body).not.toContain("test-secret-key");
    expect(observed.body).toContain('"input":["."]');
  });
});
