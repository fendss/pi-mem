#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  QdrantDenseRetriever,
  type DenseRetriever,
} from "./dense-retriever.js";
import { OpenAICompatibleEmbedder, type Embedder } from "./embedding.js";
import {
  embeddingProfile,
  indexMemoryRecordEmbeddings,
  indexMemoryRecordEmbeddingsForVectorGeneration,
} from "./embedding-index.js";
import {
  HybridMemoryStore,
  type HybridRawStore,
} from "./hybrid-search.js";
import {
  createPiModelRuntime,
  type PiModelRuntime,
} from "./model.js";
import {
  AsyncKeyedRequestGate,
  AsyncRequestGate,
} from "./request-gate.js";
import { PiMemRunError, runPiMem } from "./runtime.js";
import {
  MemoryStore,
  type AppendMemoryMessage,
} from "./store.js";
import { QdrantClient, type QdrantCollectionSpec } from "./qdrant.js";
import { SqliteRetrievalWorkerPool } from "./sqlite-retrieval-pool.js";
import type { MemoryRecord, PiMemResult } from "./types.js";
import { QdrantVectorSynchronizer } from "./vector-sync.js";
import { newRunId, sha256 } from "./util.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 100;
const MAX_OPTIONS = 100;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_QUERY_LENGTH = 100_000;
const MAX_CONTENT_LENGTH = 500_000;

export type LeaderboardAuthScheme = "token" | "bearer" | "x-api-key" | "none";

export interface LeaderboardAddRequest {
  request_id: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
  }>;
  user_id: string;
  session_id: string;
}

export interface LeaderboardAddResponse {
  success: true;
  request_id: string;
  user_id: string;
  session_id: string;
}

export interface LeaderboardSearchRequest {
  query: string;
  options?: string[];
  user_id: string;
  top_k: number;
}

export interface LeaderboardSearchItem {
  id: string;
  content: string;
  score?: number;
  created_at?: string;
}

export interface LeaderboardSearchResponse {
  data: LeaderboardSearchItem[];
}

export interface LeaderboardApiBackend {
  add(request: LeaderboardAddRequest): Promise<LeaderboardAddResponse>;
  search(
    request: LeaderboardSearchRequest,
    signal?: AbortSignal,
  ): Promise<LeaderboardSearchResponse>;
  close?(): Promise<void> | void;
}

export interface LeaderboardHttpServerOptions {
  backend: LeaderboardApiBackend;
  authScheme: LeaderboardAuthScheme;
  apiKey?: string;
  maxRequestBytes?: number;
}

export interface PiMemLeaderboardBackendOptions {
  rawStore: MemoryStore;
  embedder: Embedder;
  modelRuntime: PiModelRuntime;
  retrievalStore?: HybridRawStore;
  denseRetriever?: DenseRetriever;
  vectorSynchronizer?: QdrantVectorSynchronizer;
  vectorGenerationId?: string;
  maxConcurrentAdds?: number;
  maxConcurrentSearches?: number;
  maxRunMs?: number;
  searchAttempts?: number;
  searchArtifactDirectory?: string;
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(422, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !accepted.has(key));
  if (extra.length > 0) {
    throw new ApiError(422, `${label} has unsupported fields: ${extra.join(", ")}`);
  }
}

function nonEmptyString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(422, `${label} must be a non-empty string`);
  }
  if (value.length > maximum) {
    throw new ApiError(422, `${label} exceeds ${maximum} characters`);
  }
  return value;
}

function parseTimestamp(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ApiError(422, `${label} must be a Unix-millisecond integer`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiError(422, `${label} is outside the supported date range`);
  }
  return value;
}

export function parseLeaderboardAddRequest(value: unknown): LeaderboardAddRequest {
  const input = objectValue(value, "Add request");
  exactFields(input, ["request_id", "messages", "user_id", "session_id"], "Add request");
  const requestId = nonEmptyString(
    input.request_id,
    "request_id",
    MAX_IDENTIFIER_LENGTH,
  );
  const userId = nonEmptyString(input.user_id, "user_id", MAX_IDENTIFIER_LENGTH);
  const sessionId = nonEmptyString(
    input.session_id,
    "session_id",
    MAX_IDENTIFIER_LENGTH,
  );
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new ApiError(422, "messages must be a non-empty array");
  }
  if (input.messages.length > MAX_MESSAGES) {
    throw new ApiError(422, `messages must not contain more than ${MAX_MESSAGES} items`);
  }
  const messages = input.messages.map((raw, index) => {
    const message = objectValue(raw, `messages[${index}]`);
    exactFields(message, ["role", "content", "timestamp"], `messages[${index}]`);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new ApiError(422, `messages[${index}].role must be user or assistant`);
    }
    const role: "user" | "assistant" = message.role;
    const content = nonEmptyString(
      message.content,
      `messages[${index}].content`,
      MAX_CONTENT_LENGTH,
    );
    const timestamp = parseTimestamp(
      message.timestamp,
      `messages[${index}].timestamp`,
    );
    return {
      role,
      content,
      ...(timestamp === undefined ? {} : { timestamp }),
    };
  });
  return {
    request_id: requestId,
    messages,
    user_id: userId,
    session_id: sessionId,
  };
}

export function parseLeaderboardSearchRequest(
  value: unknown,
): LeaderboardSearchRequest {
  const input = objectValue(value, "Search request");
  exactFields(input, ["query", "options", "user_id", "top_k"], "Search request");
  const query = nonEmptyString(input.query, "query", MAX_QUERY_LENGTH);
  const userId = nonEmptyString(input.user_id, "user_id", MAX_IDENTIFIER_LENGTH);
  if (
    typeof input.top_k !== "number" ||
    !Number.isSafeInteger(input.top_k) ||
    input.top_k < 1 ||
    input.top_k > 1_000
  ) {
    throw new ApiError(422, "top_k must be an integer between 1 and 1000");
  }
  let options: string[] | undefined;
  if (input.options !== undefined) {
    if (!Array.isArray(input.options) || input.options.length > MAX_OPTIONS) {
      throw new ApiError(422, `options must be an array of at most ${MAX_OPTIONS} strings`);
    }
    options = input.options.map((option, index) =>
      nonEmptyString(option, `options[${index}]`, MAX_QUERY_LENGTH)
    );
  }
  return {
    query,
    ...(options === undefined ? {} : { options }),
    user_id: userId,
    top_k: input.top_k,
  };
}

export function leaderboardScopeId(userId: string): string {
  return `leaderboard-${sha256(userId).slice(0, 24)}`;
}

function canonicalAddHash(request: LeaderboardAddRequest): string {
  return sha256(JSON.stringify([
    request.request_id,
    request.user_id,
    request.session_id,
    request.messages.map((message) => [
      message.role,
      message.timestamp ?? null,
      message.content,
    ]),
  ]));
}

function sourceTimestamp(timestamp: number | undefined): string | undefined {
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

function retrievalQuestion(request: LeaderboardSearchRequest): string {
  if (!request.options || request.options.length === 0) return request.query;
  return [
    request.query,
    "",
    "Answer choices supplied for retrieval context:",
    ...request.options.map((option) => `- ${option}`),
  ].join("\n");
}

function uniqueCitedRawMemories(result: PiMemResult): MemoryRecord[] {
  const evidence = new Map(
    result.evidence.map((memory) => [memory.memoryId, memory]),
  );
  const unique = new Map<string, MemoryRecord>();
  for (const citation of result.citations) {
    const memory = evidence.get(citation.memoryId);
    if (!memory || memory.scopeId !== result.scopeId) {
      throw new Error(
        `Cited memory is not present in scoped read evidence: ${citation.memoryId}`,
      );
    }
    if (memory.content.length === 0) {
      throw new Error(`Cited memory has empty raw content: ${citation.memoryId}`);
    }
    if (!unique.has(memory.memoryId)) unique.set(memory.memoryId, memory);
  }
  return [...unique.values()];
}

export function buildLeaderboardSearchResponse(
  result: PiMemResult,
  query: string,
  topK: number,
): LeaderboardSearchResponse {
  const rawLimit = Math.max(0, topK - 1);
  // Match the strongest validated Direct adapter: the Answer model receives
  // the compact package and only its cited immutable sources. Uncited reads
  // and navigation candidates remain auditable internally but add prompt noise.
  const rawMemories = uniqueCitedRawMemories(result).slice(0, rawLimit);
  const includedIds = new Set(rawMemories.map((memory) => memory.memoryId));
  const capsule = {
    type: "pimem_evidence_package_v1",
    status: result.status,
    evidence_summary: result.evidenceSummary,
    ...(result.count === undefined ? {} : { count: result.count }),
    ...(result.inventory === undefined
      ? {}
      : {
          inventory: result.inventory
            .map((item) => ({
              item: item.item,
              source_ids: item.memoryIds.filter((memoryId) =>
                includedIds.has(memoryId)
              ),
            }))
            .filter((item) => item.source_ids.length > 0),
        }),
    citations: result.citations
      .filter((citation) => includedIds.has(citation.memoryId))
      .map((citation) => ({
        source_id: citation.memoryId,
        support: citation.supports,
      })),
  };
  const capsuleContent = JSON.stringify(capsule);
  const capsuleItem: LeaderboardSearchItem = {
    id: `pimem-package-${sha256(
      `${result.scopeId}\0${query}\0${capsuleContent}`,
    ).slice(0, 24)}`,
    content: capsuleContent,
    score: 1,
  };
  const rawItems = rawMemories.map((memory, index): LeaderboardSearchItem => ({
    id: memory.memoryId,
    content: memory.content,
    score: Math.max(0, 0.99 - index / Math.max(100, topK)),
    ...(memory.timestamp === undefined ? {} : { created_at: memory.timestamp }),
  }));
  return { data: [capsuleItem, ...rawItems].slice(0, topK) };
}

export async function writeSearchAgentArtifact(
  directory: string,
  request: LeaderboardSearchRequest,
  result: PiMemResult | undefined,
  response: LeaderboardSearchResponse | undefined,
  error?: unknown,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifactId = result?.runId ?? `failed-${newRunId()}`;
  const artifact = {
    schema_version: "pimem-agent-search-artifact/v1",
    artifact_id: artifactId,
    search: {
      query: request.query,
      ...(request.options === undefined ? {} : { options: request.options }),
      user_id: request.user_id,
      top_k: request.top_k,
      ...(response?.data[0] === undefined
        ? {}
        : { package_id: response.data[0].id }),
    },
    ...(result === undefined
      ? {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof PiMemRunError
            ? { agent_failure: error.diagnostics }
            : {}),
        }
      : {
          status: "ok",
          agent: {
            run_id: result.runId,
            retrieval_question: result.question,
            selection: {
              status: result.status,
              evidence_summary: result.evidenceSummary,
              citations: result.citations,
              ...(result.count === undefined ? {} : { count: result.count }),
              ...(result.inventory === undefined
                ? {}
                : { inventory: result.inventory }),
            },
            reasoning_trace: result.trace,
            memory: {
              candidates: result.candidates,
              searched_memories: result.searchedMemories,
              read_evidence: result.evidence,
              returned_items: response?.data ?? [],
            },
            metrics: result.metrics,
            retrieval: result.retrieval,
            retrieval_model: result.retrievalModel,
          },
        }),
  };
  const finalPath = join(directory, `${artifactId}.json`);
  const temporaryPath = join(directory, `.${artifactId}.${process.pid}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(artifact)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporaryPath, finalPath);
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error("Leaderboard search aborted");
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new Error("Leaderboard search aborted"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

interface RetryableSearchResult {
  status: "sufficient" | "insufficient";
  citations: readonly unknown[];
  evidence: readonly unknown[];
}

export async function runSearchWithRetries<T extends RetryableSearchResult>(
  options: {
    maxRunMs: number;
    maxAttempts: number;
    retryDelayMs?: number;
    signal?: AbortSignal;
    run: (attemptRunMs: number, attempt: number) => Promise<T>;
  },
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error("Leaderboard search aborted");
    const elapsed = Date.now() - startedAt;
    const remainingMs = options.maxRunMs - elapsed;
    if (remainingMs < 1) break;
    const perAttemptCapMs = Math.max(
      1,
      Math.floor(options.maxRunMs / options.maxAttempts),
    );
    const attemptRunMs = Math.min(remainingMs, perAttemptCapMs);
    try {
      return await options.run(attemptRunMs, attempt);
    } catch (error) {
      if (options.signal?.aborted) throw new Error("Leaderboard search aborted");
      lastError = error;
    }
    if (attempt < options.maxAttempts) {
      const delayMs = Math.min(
        options.retryDelayMs ?? 1_000 * 2 ** (attempt - 1),
        Math.max(0, options.maxRunMs - (Date.now() - startedAt) - 1),
      );
      if (delayMs > 0) {
        await new Promise<void>((resolveDelay, rejectDelay) => {
          const timer = setTimeout(finish, delayMs);
          const abort = (): void => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            rejectDelay(new Error("Leaderboard search aborted"));
          };
          function finish(): void {
            options.signal?.removeEventListener("abort", abort);
            resolveDelay();
          }
          options.signal?.addEventListener("abort", abort, { once: true });
        });
      }
    }
  }
  if (lastError !== undefined) throw lastError;
  throw new Error(`PiMem exceeded the ${options.maxRunMs}ms search limit`);
}

export class PiMemLeaderboardBackend implements LeaderboardApiBackend {
  private readonly rawStore: MemoryStore;
  private readonly embedder: Embedder;
  private readonly modelRuntime: PiModelRuntime;
  private readonly retrievalStore: HybridRawStore;
  private readonly hybridStore: HybridMemoryStore;
  private readonly addGate: AsyncRequestGate;
  private readonly addSessionGate = new AsyncKeyedRequestGate();
  private readonly searchGate: AsyncRequestGate;
  private readonly maxRunMs: number;
  private readonly searchAttempts: number;
  private readonly vectorSynchronizer: QdrantVectorSynchronizer | undefined;
  private readonly vectorGenerationId: string | undefined;
  private readonly searchArtifactDirectory: string | undefined;
  private vectorSyncTail: Promise<void> = Promise.resolve();
  private vectorFinalizePromise: Promise<void> | undefined;

  constructor(options: PiMemLeaderboardBackendOptions) {
    this.rawStore = options.rawStore;
    this.embedder = options.embedder;
    this.modelRuntime = options.modelRuntime;
    this.retrievalStore = options.retrievalStore ?? options.rawStore;
    this.hybridStore = new HybridMemoryStore(
      this.retrievalStore,
      options.embedder,
      options.denseRetriever,
    );
    this.addGate = new AsyncRequestGate(options.maxConcurrentAdds ?? 1, 1_000);
    this.searchGate = new AsyncRequestGate(
      options.maxConcurrentSearches ?? 4,
      1_000,
    );
    this.maxRunMs = options.maxRunMs ?? 120_000;
    this.searchAttempts = options.searchAttempts ?? 1;
    this.searchArtifactDirectory = options.searchArtifactDirectory;
    this.vectorSynchronizer = options.vectorSynchronizer;
    this.vectorGenerationId = options.vectorGenerationId;
    if ((this.vectorSynchronizer === undefined) !== (this.vectorGenerationId === undefined)) {
      throw new Error("Vector synchronizer and generation ID must be configured together");
    }
  }

  private scheduleVectorSync(): void {
    if (!this.vectorSynchronizer) return;
    const synchronize = this.vectorSyncTail.then(async () => {
      await this.vectorSynchronizer!.synchronizeAvailable();
    });
    // The durable outbox retains failures; Finalize retries transient work.
    this.vectorSyncTail = synchronize.catch(() => undefined);
  }

  private async ensureVectorReady(signal?: AbortSignal): Promise<void> {
    if (!this.vectorSynchronizer) return;
    if (!this.vectorFinalizePromise) {
      this.vectorFinalizePromise = (async () => {
        await this.vectorSyncTail;
        await this.vectorSynchronizer!.finalize();
      })();
    }
    const finalize = this.vectorFinalizePromise;
    try {
      await awaitWithSignal(finalize, signal);
    } catch (error) {
      if (!signal?.aborted && this.vectorFinalizePromise === finalize) {
        this.vectorFinalizePromise = undefined;
      }
      throw error;
    }
  }

  add(request: LeaderboardAddRequest): Promise<LeaderboardAddResponse> {
    const scopeId = leaderboardScopeId(request.user_id);
    const sessionKey = `${scopeId}\0${request.session_id}`;
    return this.addSessionGate.run(sessionKey, () => this.addGate.run(async () => {
      const requestHash = canonicalAddHash(request);
      const messages: AppendMemoryMessage[] = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.timestamp === undefined
          ? {}
          : { timestamp: sourceTimestamp(message.timestamp)! }),
      }));
      let appended;
      try {
        appended = this.rawStore.appendMemoryRequest({
          requestId: request.request_id,
          requestHash,
          scopeId,
          sourceSessionId: request.session_id,
          messages,
        });
      } catch (error) {
        if (error instanceof Error && /conflict/iu.test(error.message)) {
          throw new ApiError(409, "request_id was already used with different content");
        }
        throw error;
      }
      if (appended.status !== "complete") {
        if (this.vectorGenerationId === undefined) {
          await indexMemoryRecordEmbeddings(
            this.rawStore,
            appended.records,
            this.embedder,
          );
        } else {
          await indexMemoryRecordEmbeddingsForVectorGeneration(
            this.rawStore,
            appended.records,
            this.embedder,
            this.vectorGenerationId,
          );
        }
        this.rawStore.ensureEvidenceFactIndex(scopeId);
        this.rawStore.markAppendRequestComplete(request.request_id, requestHash);
        this.scheduleVectorSync();
      }
      return {
        success: true,
        request_id: request.request_id,
        user_id: request.user_id,
        session_id: request.session_id,
      };
    }));
  }

  search(
    request: LeaderboardSearchRequest,
    signal?: AbortSignal,
  ): Promise<LeaderboardSearchResponse> {
    return this.searchGate.run(async () => {
      if (signal?.aborted) throw new Error("Leaderboard search aborted");
      await this.ensureVectorReady(signal);
      const scopeId = leaderboardScopeId(request.user_id);
      if (this.rawStore.hasPendingAppendRequests(scopeId)) {
        throw new ApiError(503, "Memory ingestion is incomplete for this user_id");
      }
      if (!(await this.hybridStore.hasScopeRecords(scopeId))) {
        return { data: [] };
      }
      let result: PiMemResult;
      try {
        result = await runSearchWithRetries({
          maxRunMs: this.maxRunMs,
          maxAttempts: this.searchAttempts,
          ...(signal === undefined ? {} : { signal }),
          run: (attemptRunMs) => runPiMem({
            store: this.hybridStore,
            modelRuntime: this.modelRuntime,
            scopeId,
            question: retrievalQuestion(request),
            maxTurns: 64,
            maxToolCalls: 80,
            maxProtocolNudges: 2,
            maxRunMs: attemptRunMs,
            ...(signal === undefined ? {} : { signal }),
          }),
        });
      } catch (error) {
        if (this.searchArtifactDirectory !== undefined) {
          await writeSearchAgentArtifact(
            this.searchArtifactDirectory,
            request,
            undefined,
            undefined,
            error,
          );
        }
        throw error;
      }
      const response = buildLeaderboardSearchResponse(
        result,
        request.query,
        request.top_k,
      );
      if (this.searchArtifactDirectory !== undefined) {
        await writeSearchAgentArtifact(
          this.searchArtifactDirectory,
          request,
          result,
          response,
        );
      }
      return response;
    });
  }

  async close(): Promise<void> {
    await this.vectorSyncTail;
    if (this.retrievalStore !== this.rawStore) {
      await this.retrievalStore.close?.();
    }
    this.rawStore.close();
  }
}

async function readJsonBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maximumBytes) {
      throw new ApiError(413, `Request body exceeds ${maximumBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (received === 0) throw new ApiError(400, "Request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorize(
  request: IncomingMessage,
  scheme: LeaderboardAuthScheme,
  apiKey: string | undefined,
): void {
  if (scheme === "none") return;
  if (!apiKey) throw new Error("Authenticated server requires PIMEM_MEMORY_API_KEY");
  let actual: string | undefined;
  if (scheme === "x-api-key") {
    const header = request.headers["x-api-key"];
    actual = Array.isArray(header) ? undefined : header;
  } else {
    const authorization = request.headers.authorization;
    const prefix = scheme === "token" ? "Token " : "Bearer ";
    actual = authorization?.startsWith(prefix)
      ? authorization.slice(prefix.length)
      : undefined;
  }
  if (!actual || !equalSecret(actual, apiKey)) {
    throw new ApiError(401, "Authentication failed");
  }
}

export function createLeaderboardHttpServer(
  options: LeaderboardHttpServerOptions,
): Server {
  const maximumBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  if (options.authScheme !== "none" && !options.apiKey?.trim()) {
    throw new Error("PIMEM_MEMORY_API_KEY is required unless auth scheme is none");
  }
  return createServer(async (request, response) => {
    const requestAbort = new AbortController();
    const abort = (): void => requestAbort.abort();
    const abortClosedResponse = (): void => {
      if (!response.writableEnded) requestAbort.abort();
    };
    request.once("aborted", abort);
    response.once("close", abortClosedResponse);
    try {
      const url = new URL(request.url ?? "/", "http://pimem.local");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method !== "POST") {
        throw new ApiError(404, "Route not found");
      }
      authorize(request, options.authScheme, options.apiKey);
      const body = await readJsonBody(request, maximumBytes);
      if (url.pathname === "/v1/memories/add") {
        const result = await options.backend.add(parseLeaderboardAddRequest(body));
        sendJson(response, 200, result);
        return;
      }
      if (url.pathname === "/v1/memories/search") {
        const result = await options.backend.search(
          parseLeaderboardSearchRequest(body),
          requestAbort.signal,
        );
        sendJson(response, 200, result);
        return;
      }
      throw new ApiError(404, "Route not found");
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof ApiError) {
        sendJson(response, error.status, { detail: { reason: error.message } });
        return;
      }
      console.error("PiMem leaderboard request failed:",
        error instanceof Error ? error.message : String(error));
      sendJson(response, 503, {
        detail: { reason: "PiMem is temporarily unable to complete the request" },
      });
    } finally {
      request.off("aborted", abort);
      response.off("close", abortClosedResponse);
    }
  });
}

function positiveEnvironmentInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function authSchemeFromEnvironment(): LeaderboardAuthScheme {
  const value = process.env.PIMEM_AUTH_SCHEME?.trim().toLowerCase() || "x-api-key";
  if (!new Set(["token", "bearer", "x-api-key", "none"]).has(value)) {
    throw new Error("PIMEM_AUTH_SCHEME is invalid");
  }
  return value as LeaderboardAuthScheme;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function modelRuntimeFromEnvironment(): PiModelRuntime {
  const maxTokensField =
    process.env.PIMEM_AGENT_MAX_TOKENS_FIELD?.trim() || "max_tokens";
  if (
    maxTokensField !== "max_tokens" &&
    maxTokensField !== "max_completion_tokens"
  ) {
    throw new Error("PIMEM_AGENT_MAX_TOKENS_FIELD is invalid");
  }
  return createPiModelRuntime({
    providerId: process.env.PIMEM_AGENT_PROVIDER?.trim() || "pimem-openai",
    modelId: process.env.PIMEM_AGENT_MODEL?.trim() || "gpt-4o-mini",
    baseUrl: requiredEnvironment("PIMEM_AGENT_BASE_URL"),
    apiKeyEnv:
      process.env.PIMEM_AGENT_API_KEY_ENV?.trim() || "PIMEM_AGENT_API_KEY",
    thinkingLevel: (
      process.env.PIMEM_AGENT_THINKING_LEVEL?.trim() || "off"
    ) as PiModelRuntime["thinkingLevel"],
    contextWindow: positiveEnvironmentInteger(
      "PIMEM_AGENT_CONTEXT_WINDOW",
      128_000,
      10_000_000,
    ),
    maxTokens: positiveEnvironmentInteger(
      "PIMEM_AGENT_MAX_TOKENS",
      16_384,
      1_000_000,
    ),
    maxTokensField,
  });
}

export async function startLeaderboardServer(): Promise<void> {
  process.umask(0o077);
  const dataDir = resolve(process.env.PIMEM_DATA_DIR?.trim() || "/data");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const rawStore = await MemoryStore.create(join(dataDir, "memory.sqlite"));
  const embedder = OpenAICompatibleEmbedder.fromEnvironment();
  const modelRuntime = modelRuntimeFromEnvironment();
  const denseBackend = process.env.PIMEM_DENSE_BACKEND?.trim() || "sqlite-exact";
  if (!new Set(["sqlite-exact", "qdrant-hnsw"]).has(denseBackend)) {
    throw new Error("PIMEM_DENSE_BACKEND must be sqlite-exact or qdrant-hnsw");
  }
  let retrievalStore: HybridRawStore | undefined;
  let denseRetriever: DenseRetriever | undefined;
  let vectorSynchronizer: QdrantVectorSynchronizer | undefined;
  let vectorGenerationId: string | undefined;
  if (denseBackend === "qdrant-hnsw") {
    vectorGenerationId = requiredEnvironment("PIMEM_VECTOR_GENERATION_ID");
    const collection: QdrantCollectionSpec = {
      name: process.env.PIMEM_QDRANT_COLLECTION?.trim() || "pimem_vectors_v1",
      dimensions: embedder.dimensions,
      indexingThresholdKb: positiveEnvironmentInteger(
        "PIMEM_QDRANT_INDEXING_THRESHOLD_KB",
        10_000,
        1_000_000_000,
      ),
      hnsw: {
        m: positiveEnvironmentInteger("PIMEM_QDRANT_HNSW_M", 32, 256),
        efConstruct: positiveEnvironmentInteger(
          "PIMEM_QDRANT_EF_CONSTRUCT",
          200,
          10_000,
        ),
        fullScanThresholdKb: positiveEnvironmentInteger(
          "PIMEM_QDRANT_FULL_SCAN_THRESHOLD_KB",
          1_000,
          1_000_000_000,
        ),
      },
    };
    const generation = rawStore.beginVectorIndexGeneration({
      generationId: vectorGenerationId,
      collectionName: collection.name,
      profile: embeddingProfile(embedder),
    });
    if (generation.state === "failed") {
      throw new Error(`Vector generation is failed: ${vectorGenerationId}`);
    }
    const qdrant = new QdrantClient({
      baseUrl: requiredEnvironment("PIMEM_QDRANT_URL"),
      timeoutMs: positiveEnvironmentInteger(
        "PIMEM_QDRANT_TIMEOUT_MS",
        120_000,
        600_000,
      ),
    });
    vectorSynchronizer = new QdrantVectorSynchronizer({
      store: rawStore,
      client: qdrant,
      generationId: vectorGenerationId,
      collection,
      batchSize: positiveEnvironmentInteger(
        "PIMEM_QDRANT_SYNC_BATCH_SIZE",
        512,
        10_000,
      ),
      concurrentBatches: positiveEnvironmentInteger(
        "PIMEM_QDRANT_SYNC_CONCURRENCY",
        4,
        64,
      ),
    });
    await vectorSynchronizer.initialize();
    const sqliteRetrievalStore = await SqliteRetrievalWorkerPool.create({
      databasePath: rawStore.databasePath,
      size: positiveEnvironmentInteger(
        "PIMEM_SQLITE_RETRIEVAL_WORKERS",
        128,
        128,
      ),
    });
    retrievalStore = sqliteRetrievalStore;
    denseRetriever = new QdrantDenseRetriever({
      store: sqliteRetrievalStore,
      client: qdrant,
      generationId: vectorGenerationId,
      collectionName: collection.name,
      hnswEf: positiveEnvironmentInteger("PIMEM_QDRANT_HNSW_EF", 800, 10_000),
    });
  }
  const backend = new PiMemLeaderboardBackend({
    rawStore,
    embedder,
    modelRuntime,
    ...(retrievalStore === undefined ? {} : { retrievalStore }),
    ...(denseRetriever === undefined ? {} : { denseRetriever }),
    ...(vectorSynchronizer === undefined ? {} : { vectorSynchronizer }),
    ...(vectorGenerationId === undefined ? {} : { vectorGenerationId }),
    maxConcurrentAdds: positiveEnvironmentInteger(
      "PIMEM_MAX_CONCURRENT_ADDS",
      1,
      32,
    ),
    maxConcurrentSearches: positiveEnvironmentInteger(
      "PIMEM_MAX_CONCURRENT_SEARCHES",
      4,
      128,
    ),
    maxRunMs: positiveEnvironmentInteger("PIMEM_MAX_RUN_MS", 120_000, 600_000),
    searchAttempts: positiveEnvironmentInteger("PIMEM_SEARCH_ATTEMPTS", 1, 5),
    ...(process.env.PIMEM_SEARCH_ARTIFACT_DIR?.trim()
      ? {
          searchArtifactDirectory: resolve(
            process.env.PIMEM_SEARCH_ARTIFACT_DIR.trim(),
          ),
        }
      : {}),
  });
  const authScheme = authSchemeFromEnvironment();
  const apiKey = process.env.PIMEM_MEMORY_API_KEY;
  const server = createLeaderboardHttpServer({
    backend,
    authScheme,
    ...(apiKey === undefined ? {} : { apiKey }),
  });
  const host = process.env.PIMEM_HOST?.trim() || "0.0.0.0";
  const port = positiveEnvironmentInteger("PIMEM_PORT", 8080, 65_535);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  console.log(`PiMem leaderboard API listening on ${host}:${port}`);
  const shutdown = (): void => {
    server.close(() => {
      void Promise.resolve(backend.close()).finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (entryPath === import.meta.url) {
  startLeaderboardServer().catch((error) => {
    console.error("PiMem leaderboard server failed:",
      error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
