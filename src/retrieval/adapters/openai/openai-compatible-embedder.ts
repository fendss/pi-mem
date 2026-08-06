import type { AsyncRequestGate } from "../../../platform/concurrency/request-gate.js";
import { sha256 } from "../../../util.js";
import type {
  Embedder,
  EmbeddingMetrics,
  EmbeddingRequestOptions,
} from "../../model/embedder.js";

export type {
  Embedder,
  EmbeddingMetrics,
  EmbeddingRequestOptions,
} from "../../model/embedder.js";

export interface OpenAICompatibleEmbedderOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  dimensions?: number;
  maxInputLength?: number;
  batchSize?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  requestGate?: AsyncRequestGate;
}

const SPECIAL_TOKEN_PATTERN =
  /<\|endoftext\|>|<\|im_start\|>|<\|im_end\|>|<\|fim_prefix\|>|<\|fim_middle\|>|<\|fim_suffix\|>|<\|endofprompt\|>/gu;
const INPUT_FORMAT_VERSION = "role-colon-content-v1";
const CLEANING_VERSION = "openai-special-token-cleaning-v1";
const MAX_INPUTS_PER_REQUEST = 2048;
const MAX_CODE_POINTS_PER_REQUEST = 75_000;

class EmbeddingHttpError extends Error {
  readonly status: number;
  readonly dimensionsUnsupported: boolean;

  constructor(status: number, dimensionsUnsupported = false) {
    super(`Embedding endpoint returned HTTP ${status}`);
    this.name = "EmbeddingHttpError";
    this.status = status;
    this.dimensionsUnsupported = dimensionsUnsupported;
  }
}

class EmbeddingResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingResponseError";
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function endpointFor(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("PIMEM_EMBEDDING_BASE_URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("PIMEM_EMBEDDING_BASE_URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("PIMEM_EMBEDDING_BASE_URL must not contain credentials");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/embeddings`;
  return parsed.toString();
}

export function cleanEmbeddingText(text: string): string {
  const cleaned = text.replace(SPECIAL_TOKEN_PATTERN, "");
  return cleaned.length === 0 ? "." : cleaned;
}

/** Balances chunks by Unicode code point, following PiMem's Unicode code-point contract. */
export function chunkTextBalanced(text: string, maxLength: number): string[] {
  positiveInteger(maxLength, "maxLength");
  const codePoints = [...text];
  if (codePoints.length === 0) return [];
  const numberOfChunks = Math.ceil(codePoints.length / maxLength);
  const chunkSize = Math.ceil(codePoints.length / numberOfChunks);
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += chunkSize) {
    chunks.push(codePoints.slice(offset, offset + chunkSize).join(""));
  }
  return chunks;
}

function validateVector(vector: unknown, dimensions: number): number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new EmbeddingResponseError(
      `Embedding response must contain ${dimensions}-dimensional vectors`,
    );
  }
  return vector.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new EmbeddingResponseError(
        "Embedding response contains a non-finite vector value",
      );
    }
    return value;
  });
}

function averageVectors(vectors: readonly number[][], dimensions: number): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot average an empty embedding vector group");
  }
  const average = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    const validated = validateVector(vector, dimensions);
    for (let index = 0; index < dimensions; index += 1) {
      average[index]! += validated[index]!;
    }
  }
  for (let index = 0; index < dimensions; index += 1) {
    average[index]! /= vectors.length;
  }
  return average;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  variable: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return positiveInteger(parsed, variable);
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Embedding request aborted");
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Embedding request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function clusterChunks(chunks: readonly string[], batchSize: number): string[][] {
  const clusters: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;
  const maximumCount = Math.min(batchSize, MAX_INPUTS_PER_REQUEST);
  for (const chunk of chunks) {
    const length = [...chunk].length;
    if (
      current.length > 0 &&
      (current.length >= maximumCount ||
        currentLength + length > MAX_CODE_POINTS_PER_REQUEST)
    ) {
      clusters.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(chunk);
    currentLength += length;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

export class OpenAICompatibleEmbedder implements Embedder {
  readonly profileId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxInputLength: number;
  readonly batchSize: number;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly requestGate: AsyncRequestGate | undefined;
  private dimensionsParameterEnabled = true;
  private calls = 0;
  private latencyMs = 0;

  constructor(options: OpenAICompatibleEmbedderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("PIMEM_EMBEDDING_API_KEY is required for pimem-hybrid");
    }
    this.endpoint = endpointFor(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "text-embedding-v4";
    this.dimensions = positiveInteger(options.dimensions ?? 1024, "dimensions");
    this.maxInputLength = positiveInteger(
      options.maxInputLength ?? 2048,
      "maxInputLength",
    );
    this.batchSize = positiveInteger(options.batchSize ?? 10, "batchSize");
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, "timeoutMs");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestGate = options.requestGate;
    const profileConfig = JSON.stringify({
      provider: "openai-compatible",
      model: this.model,
      dimensions: this.dimensions,
      similarity: "cosine",
      maxInputLength: this.maxInputLength,
      inputFormat: INPUT_FORMAT_VERSION,
      cleaning: CLEANING_VERSION,
      chunkAggregation: "arithmetic-mean-v1",
    });
    this.profileId = `embedding-${sha256(profileConfig).slice(0, 24)}`;
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    fetchImpl?: typeof fetch,
    requestGate?: AsyncRequestGate,
  ): OpenAICompatibleEmbedder {
    const baseUrl = environment.PIMEM_EMBEDDING_BASE_URL?.trim();
    if (!baseUrl) {
      throw new Error("PIMEM_EMBEDDING_BASE_URL is required for pimem-hybrid");
    }
    const apiKey = environment.PIMEM_EMBEDDING_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error("PIMEM_EMBEDDING_API_KEY is required for pimem-hybrid");
    }
    return new OpenAICompatibleEmbedder({
      baseUrl,
      apiKey,
      model: environment.PIMEM_EMBEDDING_MODEL?.trim() || "text-embedding-v4",
      dimensions: parsePositiveInteger(
        environment.PIMEM_EMBEDDING_DIMENSIONS,
        1024,
        "PIMEM_EMBEDDING_DIMENSIONS",
      ),
      maxInputLength: parsePositiveInteger(
        environment.PIMEM_EMBEDDING_MAX_INPUT_LENGTH,
        2048,
        "PIMEM_EMBEDDING_MAX_INPUT_LENGTH",
      ),
      batchSize: parsePositiveInteger(
        environment.PIMEM_EMBEDDING_BATCH_SIZE,
        10,
        "PIMEM_EMBEDDING_BATCH_SIZE",
      ),
      timeoutMs: parsePositiveInteger(
        environment.PIMEM_EMBEDDING_TIMEOUT_MS,
        30_000,
        "PIMEM_EMBEDDING_TIMEOUT_MS",
      ),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      ...(requestGate === undefined ? {} : { requestGate }),
    });
  }

  embedDocuments(
    texts: readonly string[],
    options: EmbeddingRequestOptions = {},
  ): Promise<number[][]> {
    return this.embed(texts, options.signal);
  }

  embedQueries(
    texts: readonly string[],
    options: EmbeddingRequestOptions = {},
  ): Promise<number[][]> {
    return this.embed(texts, options.signal);
  }

  snapshotMetrics(): EmbeddingMetrics {
    return { calls: this.calls, latencyMs: this.latencyMs };
  }

  private async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const chunksByInput = texts.map((text) =>
      chunkTextBalanced(cleanEmbeddingText(text), this.maxInputLength),
    );
    const flatChunks = chunksByInput.flat();
    const clusters = clusterChunks(flatChunks, this.batchSize);
    const flatVectors: number[][] = [];
    for (const cluster of clusters) {
      flatVectors.push(...await this.embedCluster(cluster, signal));
    }

    const results: number[][] = [];
    let offset = 0;
    for (const chunks of chunksByInput) {
      const vectors = flatVectors.slice(offset, offset + chunks.length);
      results.push(averageVectors(vectors, this.dimensions));
      offset += chunks.length;
    }
    if (offset !== flatVectors.length) {
      throw new Error("Embedding response could not be mapped back to inputs");
    }
    return results;
  }

  private embedCluster(
    inputs: readonly string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    return this.embedClusterWithRetries(inputs, signal);
  }

  private requestThroughGate(
    inputs: readonly string[],
    includeDimensions: boolean,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const operation = (): Promise<number[][]> =>
      this.request(inputs, includeDimensions, signal);
    return this.requestGate ? this.requestGate.run(operation) : operation();
  }

  private async embedClusterWithRetries(
    inputs: readonly string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    let includeDimensions = this.dimensionsParameterEnabled;
    let usedNoDimensionsFallback = false;
    let retryDelayMs = 1_000;
    while (true) {
      try {
        const result = await this.requestThroughGate(
          inputs,
          includeDimensions,
          signal,
        );
        if (!includeDimensions) this.dimensionsParameterEnabled = false;
        return result;
      } catch (error) {
        if (
          error instanceof EmbeddingHttpError &&
          error.status === 400 &&
          error.dimensionsUnsupported &&
          includeDimensions &&
          !usedNoDimensionsFallback
        ) {
          includeDimensions = false;
          usedNoDimensionsFallback = true;
          try {
            const result = await this.requestThroughGate(inputs, false, signal);
            this.dimensionsParameterEnabled = false;
            return result;
          } catch (fallbackError) {
            error = fallbackError;
          }
        }
        if (signal?.aborted) throw new Error("Embedding request aborted");
        await wait(retryDelayMs, signal);
        retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      }
    }
  }

  private async request(
    inputs: readonly string[],
    includeDimensions: boolean,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (signal?.aborted) throw new Error("Embedding request aborted");
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = (): void => controller.abort();
    signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    timeout.unref();
    const started = performance.now();
    this.calls += 1;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: this.model,
          ...(includeDimensions ? { dimensions: this.dimensions } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new EmbeddingHttpError(
          response.status,
          response.status === 400 && /dimensions?/iu.test(errorText),
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new EmbeddingResponseError(
          "Embedding endpoint returned invalid JSON",
        );
      }
      return this.parseResponse(payload, inputs.length);
    } catch (error) {
      if (timedOut) throw new Error("Embedding request timed out");
      if (signal?.aborted) throw new Error("Embedding request aborted");
      throw error;
    } finally {
      this.latencyMs += performance.now() - started;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  private parseResponse(payload: unknown, inputCount: number): number[][] {
    if (typeof payload !== "object" || payload === null || !("data" in payload)) {
      throw new EmbeddingResponseError(
        "Embedding endpoint response has no data array",
      );
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length !== inputCount) {
      throw new EmbeddingResponseError(
        "Embedding endpoint returned an incomplete data array",
      );
    }
    const ordered: Array<number[] | undefined> = Array.from(
      { length: inputCount },
      () => undefined,
    );
    for (const item of data) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("index" in item) ||
        !("embedding" in item)
      ) {
        throw new EmbeddingResponseError(
          "Embedding endpoint returned an invalid data item",
        );
      }
      const index = (item as { index?: unknown }).index;
      if (
        typeof index !== "number" ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= inputCount ||
        ordered[index] !== undefined
      ) {
        throw new EmbeddingResponseError(
          "Embedding endpoint returned invalid or duplicate indexes",
        );
      }
      ordered[index] = validateVector(
        (item as { embedding?: unknown }).embedding,
        this.dimensions,
      );
    }
    if (ordered.some((vector) => vector === undefined)) {
      throw new EmbeddingResponseError(
        "Embedding endpoint response indexes are incomplete",
      );
    }
    return ordered as number[][];
  }
}
