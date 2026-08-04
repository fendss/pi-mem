import { assertNonEmpty } from "./util.js";

export interface RerankDocument {
  id: string;
  text: string;
}

export interface RerankerMetadata {
  model: string;
  revision: string;
  manifestSha256?: string;
}

export interface Reranker {
  readonly metadata: RerankerMetadata;
  rerank(
    query: string,
    documents: readonly RerankDocument[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, number>>;
}

export interface HttpRerankerOptions extends RerankerMetadata {
  baseUrl: string;
  timeoutMs?: number;
  maxDocuments?: number;
}

function endpointUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Reranker base URL must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Reranker base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Reranker base URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Reranker base URL must not contain a query or fragment");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/v1/rerank`;
  return parsed.toString();
}

function probabilityScore(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`${label} must be a finite probability from 0 to 1`);
  }
  return value;
}

export class HttpReranker implements Reranker {
  readonly metadata: RerankerMetadata;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly maxDocuments: number;

  constructor(options: HttpRerankerOptions) {
    this.metadata = {
      model: assertNonEmpty(options.model, "reranker model"),
      revision: assertNonEmpty(options.revision, "reranker revision"),
      ...(options.manifestSha256 === undefined
        ? {}
        : {
            manifestSha256: assertNonEmpty(
              options.manifestSha256,
              "reranker manifest SHA-256",
            ),
          }),
    };
    this.endpoint = endpointUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxDocuments = options.maxDocuments ?? 100;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Reranker timeoutMs must be a positive integer");
    }
    if (
      !Number.isSafeInteger(this.maxDocuments) ||
      this.maxDocuments <= 0 ||
      this.maxDocuments > 100
    ) {
      throw new Error("Reranker maxDocuments must be an integer from 1 to 100");
    }
  }

  async rerank(
    query: string,
    documents: readonly RerankDocument[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, number>> {
    assertNonEmpty(query, "reranker query");
    if (documents.length === 0) return new Map();
    if (documents.length > this.maxDocuments) {
      throw new Error(
        `Reranker received ${documents.length} documents; maximum is ${this.maxDocuments}`,
      );
    }
    const expected = new Set<string>();
    for (const document of documents) {
      const id = assertNonEmpty(document.id, "reranker document ID");
      assertNonEmpty(document.text, `reranker document ${id}`);
      if (expected.has(id)) throw new Error(`Duplicate reranker document ID: ${id}`);
      expected.add(id);
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal === undefined
      ? timeout
      : AbortSignal.any([signal, timeout]);
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, documents }),
      signal: requestSignal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 512);
      throw new Error(
        `Reranker request failed with HTTP ${response.status}: ${detail}`,
      );
    }
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("Reranker response must be an object");
    }
    const object = payload as Record<string, unknown>;
    if (object.model !== this.metadata.model) {
      throw new Error(
        `Reranker substituted model ${String(object.model)}; expected ${this.metadata.model}`,
      );
    }
    if (object.revision !== this.metadata.revision) {
      throw new Error(
        `Reranker substituted revision ${String(object.revision)}; ` +
          `expected ${this.metadata.revision}`,
      );
    }
    if (
      this.metadata.manifestSha256 !== undefined &&
      object.manifest_sha256 !== this.metadata.manifestSha256
    ) {
      throw new Error(
        `Reranker substituted manifest ${String(object.manifest_sha256)}; ` +
          `expected ${this.metadata.manifestSha256}`,
      );
    }
    if (!Array.isArray(object.scores) || object.scores.length !== documents.length) {
      throw new Error("Reranker response score count does not match document count");
    }
    const scores = new Map<string, number>();
    for (const [index, item] of object.scores.entries()) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error(`Reranker scores[${index}] must be an object`);
      }
      const score = item as Record<string, unknown>;
      const id = score.id;
      if (typeof id !== "string" || !expected.has(id)) {
        throw new Error(`Reranker returned unknown document ID: ${String(id)}`);
      }
      if (scores.has(id)) throw new Error(`Reranker returned duplicate document ID: ${id}`);
      scores.set(id, probabilityScore(score.score, `Reranker score for ${id}`));
    }
    if (scores.size !== expected.size) {
      throw new Error("Reranker response omitted one or more documents");
    }
    return scores;
  }
}
