#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenAICompatibleEmbedder, type Embedder } from "./embedding.js";
import { indexScopeEmbeddings } from "./embedding-index.js";
import { HybridMemoryStore } from "./hybrid-search.js";
import {
  createPiModelRuntime,
  type PiModelRuntime,
} from "./model.js";
import { AsyncRequestGate } from "./request-gate.js";
import { runPiMem } from "./runtime.js";
import {
  MemoryStore,
  type AppendMemoryMessage,
} from "./store.js";
import type { MemoryRecord, PiMemResult } from "./types.js";
import { sha256 } from "./util.js";

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
  search(request: LeaderboardSearchRequest): Promise<LeaderboardSearchResponse>;
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
  maxConcurrentAdds?: number;
  maxConcurrentSearches?: number;
  maxRunMs?: number;
  searchAttempts?: number;
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

function uniqueRawMemories(result: PiMemResult): MemoryRecord[] {
  const orderedIds = [
    ...result.citations.map((citation) => citation.memoryId),
    ...result.evidence.map((memory) => memory.memoryId),
    ...result.searchedMemories.map((memory) => memory.memoryId),
  ];
  const records = new Map<string, MemoryRecord>(
    result.searchedMemories.map((memory) => [memory.memoryId, memory]),
  );
  for (const memory of result.evidence) records.set(memory.memoryId, memory);
  const unique = new Map<string, MemoryRecord>();
  for (const memoryId of orderedIds) {
    const memory = records.get(memoryId);
    if (memory && memory.content.length > 0 && !unique.has(memoryId)) {
      unique.set(memoryId, memory);
    }
  }
  return [...unique.values()];
}

export function buildLeaderboardSearchResponse(
  result: PiMemResult,
  query: string,
  topK: number,
): LeaderboardSearchResponse {
  const rawLimit = Math.max(0, topK - 1);
  const rawMemories = uniqueRawMemories(result).slice(0, rawLimit);
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
    run: (attemptRunMs: number, attempt: number) => Promise<T>;
  },
): Promise<T> {
  const startedAt = Date.now();
  let best: T | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = options.maxRunMs - elapsed;
    if (remainingMs < 1) break;
    const attemptRunMs = remainingMs;
    try {
      const result = await options.run(attemptRunMs, attempt);
      if (
        best === undefined ||
        Number(result.status === "sufficient") >
          Number(best.status === "sufficient") ||
        (
          result.status === best.status &&
          (result.citations.length > best.citations.length ||
            (
              result.citations.length === best.citations.length &&
              result.evidence.length > best.evidence.length
            ))
        )
      ) {
        best = result;
      }
      if (result.status === "sufficient") return result;
    } catch (error) {
      lastError = error;
    }
    if (attempt < options.maxAttempts) {
      const delayMs = Math.min(
        options.retryDelayMs ?? 1_000 * 2 ** (attempt - 1),
        Math.max(0, options.maxRunMs - (Date.now() - startedAt) - 1),
      );
      if (delayMs > 0) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  }
  if (best !== undefined) return best;
  if (lastError !== undefined) throw lastError;
  throw new Error(`PiMem exceeded the ${options.maxRunMs}ms search limit`);
}

export class PiMemLeaderboardBackend implements LeaderboardApiBackend {
  private readonly rawStore: MemoryStore;
  private readonly embedder: Embedder;
  private readonly modelRuntime: PiModelRuntime;
  private readonly hybridStore: HybridMemoryStore;
  private readonly addGate: AsyncRequestGate;
  private readonly searchGate: AsyncRequestGate;
  private readonly maxRunMs: number;
  private readonly searchAttempts: number;

  constructor(options: PiMemLeaderboardBackendOptions) {
    this.rawStore = options.rawStore;
    this.embedder = options.embedder;
    this.modelRuntime = options.modelRuntime;
    this.hybridStore = new HybridMemoryStore(options.rawStore, options.embedder);
    this.addGate = new AsyncRequestGate(options.maxConcurrentAdds ?? 1, 1_000);
    this.searchGate = new AsyncRequestGate(
      options.maxConcurrentSearches ?? 4,
      1_000,
    );
    this.maxRunMs = options.maxRunMs ?? 120_000;
    this.searchAttempts = options.searchAttempts ?? 1;
  }

  add(request: LeaderboardAddRequest): Promise<LeaderboardAddResponse> {
    return this.addGate.run(async () => {
      const scopeId = leaderboardScopeId(request.user_id);
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
        await indexScopeEmbeddings(this.rawStore, scopeId, this.embedder);
        this.rawStore.ensureEvidenceFactIndex(scopeId);
        this.rawStore.markAppendRequestComplete(request.request_id, requestHash);
      }
      return {
        success: true,
        request_id: request.request_id,
        user_id: request.user_id,
        session_id: request.session_id,
      };
    });
  }

  search(request: LeaderboardSearchRequest): Promise<LeaderboardSearchResponse> {
    return this.searchGate.run(async () => {
      const scopeId = leaderboardScopeId(request.user_id);
      if (this.rawStore.hasPendingAppendRequests(scopeId)) {
        throw new ApiError(503, "Memory ingestion is incomplete for this user_id");
      }
      if (this.rawStore.listScopeRecords(scopeId).length === 0) {
        return { data: [] };
      }
      const result = await runSearchWithRetries({
        maxRunMs: this.maxRunMs,
        maxAttempts: this.searchAttempts,
        run: (attemptRunMs) => runPiMem({
          store: this.hybridStore,
          modelRuntime: this.modelRuntime,
          scopeId,
          question: retrievalQuestion(request),
          maxRunMs: attemptRunMs,
        }),
      });
      return buildLeaderboardSearchResponse(
        result,
        request.query,
        request.top_k,
      );
    });
  }

  close(): void {
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
        );
        sendJson(response, 200, result);
        return;
      }
      throw new ApiError(404, "Route not found");
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.status, { detail: { reason: error.message } });
        return;
      }
      console.error("PiMem leaderboard request failed:",
        error instanceof Error ? error.message : String(error));
      sendJson(response, 503, {
        detail: { reason: "PiMem is temporarily unable to complete the request" },
      });
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
  const backend = new PiMemLeaderboardBackend({
    rawStore,
    embedder,
    modelRuntime,
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
