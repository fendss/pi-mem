import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  MEMORYARENA_PUBLIC_MEMORY_SYSTEM,
  MemoryArenaPublicError,
} from "../../benchmark/memoryarena-public/index.js";
import { createMemoryArenaPublicRuntime } from "../../benchmark/memoryarena-public/composition/create-runtime.js";
import {
  type PiMemSkill,
} from "../../evidence-agent/index.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
  type PiModelRuntime,
} from "../../platform/pi/load-model-runtime.js";
import { OpenAICompatibleEmbedder } from "../../retrieval/adapters/openai/openai-compatible-embedder.js";
import {
  MemoryArenaPublicApiService,
  MemoryArenaPublicApplication,
} from "./application.js";
import { memoryArenaHttpError } from "./http-errors.js";
import { createMemoryArenaRuntimeIdentity } from "./runtime-contract.js";

const MAX_BODY_BYTES = 32 * 1024 * 1024;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerEnvironment(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function thinkingLevelEnvironment(): NonNullable<
  LoadPiModelRuntimeOptions["thinkingLevel"]
> {
  const value = process.env.PIMEM_THINKING_LEVEL?.trim() || "high";
  if (!new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]).has(value)) {
    throw new Error("PIMEM_THINKING_LEVEL is invalid");
  }
  return value as NonNullable<LoadPiModelRuntimeOptions["thinkingLevel"]>;
}

function skillEnvironment(): PiMemSkill {
  const value = process.env.PIMEM_SKILL?.trim() || "pimem-v0";
  if (!new Set(["none", "pimem-minimal", "pimem-v0"]).has(value)) {
    throw new Error("PIMEM_SKILL is invalid");
  }
  return value as PiMemSkill;
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new MemoryArenaPublicError({
        code: "contract_error",
        message: "Request body exceeds 32 MiB",
        httpStatus: 422,
      });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new MemoryArenaPublicError({
      code: "contract_error",
      message: "Request body is required",
      httpStatus: 422,
    });
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new MemoryArenaPublicError({
      code: "contract_error",
      message: "Request body must be valid JSON",
      httpStatus: 422,
    });
  }
}

function respond(
  response: ServerResponse,
  status: number,
  body: unknown,
  retryable = false,
  errorCode?: string,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(errorCode === undefined
      ? {}
      : {
          "x-pimem-error-code": errorCode,
          "x-pimem-retryable": String(retryable),
        }),
    ...(retryable
      ? { "retry-after": "5" }
      : {}),
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function main(): Promise<void> {
  const dataDir = resolve(
    process.env.PIMEM_DATA_DIR?.trim() || "./data/memoryarena-public",
  );
  const loadedModelRuntime = await loadPiModelRuntime({
    agentDir: resolve(
      process.env.PIMEM_AGENT_DIR?.trim() || "./deploy/benchmark-agent-config",
    ),
    providerId:
      process.env.PIMEM_PROVIDER?.trim() || "pimem-openai-responses",
    modelId: process.env.PIMEM_MODEL?.trim() || "gpt-5.4-mini",
    thinkingLevel: thinkingLevelEnvironment(),
    baseUrl:
      process.env.OPENAI_API_BASE?.trim() ||
      requiredEnvironment("PIMEM_AGENT_BASE_URL"),
    apiKeyEnv: process.env.PIMEM_API_KEY_ENV?.trim() || "OPENAI_API_KEY",
    transport: process.env.PIMEM_TRANSPORT?.trim() === "non-stream"
      ? "non-stream"
      : "sse",
  });
  const requestPolicy = {
    timeoutMs: loadedModelRuntime.model.reasoning ? 120_000 : 90_000,
    maxRetries: 1,
    maxRetryDelayMs: 5_000,
  };
  const modelRuntime: PiModelRuntime = {
    ...loadedModelRuntime,
    requestPolicy,
    streamFn: (model, context, options) =>
      loadedModelRuntime.streamFn(model, context, {
        timeoutMs: requestPolicy.timeoutMs,
        maxRetries: requestPolicy.maxRetries,
        maxRetryDelayMs: requestPolicy.maxRetryDelayMs,
        ...options,
      }),
  };
  const embedder = OpenAICompatibleEmbedder.fromEnvironment();
  const skill = skillEnvironment();
  const maxRunMs = integerEnvironment("PIMEM_MAX_RUN_MS", 300_000, 1_800_000);
  const maxTurns = integerEnvironment("PIMEM_MAX_TURNS", 64, 256);
  const maxToolCalls = integerEnvironment("PIMEM_MAX_TOOL_CALLS", 80, 512);
  const maxSearchCalls = integerEnvironment("PIMEM_MAX_SEARCH_CALLS", 4, 16);
  const maximumConcurrentWraps = integerEnvironment(
    "PIMEM_MAX_CONCURRENT_WRAPS",
    16,
    256,
  );
  const runtime = await createMemoryArenaPublicRuntime({
    dataDir,
    modelRuntime,
    embedder,
    memorySystemName:
      process.env.PIMEM_MEMORY_SYSTEM_NAME?.trim() ||
      MEMORYARENA_PUBLIC_MEMORY_SYSTEM,
    skill,
    maxRunMs,
    maxTurns,
    maxToolCalls,
  });
  const runtimeIdentity = createMemoryArenaRuntimeIdentity({
    sourceIdentity: requiredEnvironment("PIMEM_SOURCE_IDENTITY"),
    buildIdentity: requiredEnvironment("PIMEM_BUILD_IDENTITY"),
    skill,
    modelRuntime,
    logicalModelId: requiredEnvironment("PIMEM_LOGICAL_MODEL_ID"),
    protocol: requiredEnvironment("PIMEM_RETRIEVAL_PROTOCOL"),
    baseUrl:
      process.env.OPENAI_API_BASE?.trim() ||
      requiredEnvironment("PIMEM_AGENT_BASE_URL"),
    maxRunMs,
    maxTurns,
    maxToolCalls,
    maxSearchCalls,
    requestTimeoutMs: requestPolicy.timeoutMs,
    requestMaxRetries: requestPolicy.maxRetries,
    requestMaxRetryDelayMs: requestPolicy.maxRetryDelayMs,
    maxConcurrentWraps: maximumConcurrentWraps,
  });
  const expectedRuntimeIdentity = process.env
    .PIMEM_EXPECTED_RUNTIME_IDENTITY_SHA256?.trim();
  if (
    expectedRuntimeIdentity !== undefined &&
    expectedRuntimeIdentity !== runtimeIdentity.sha256
  ) {
    throw new Error("Configured runtime identity does not match the service contract");
  }
  const service = new MemoryArenaPublicApiService(
    new MemoryArenaPublicApplication(runtime.backend, {
      maximumConcurrentWraps,
    }),
    runtimeIdentity,
    runtime.persistenceIdentity,
  );
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = integerEnvironment("PORT", 3111, 65_535);
  const server = createServer(async (request, response) => {
    const started = Date.now();
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
      if (request.method === "GET" && path === "/health") {
        respond(response, 200, service.health());
        return;
      }
      if (request.method === "GET" && path === "/runtime") {
        respond(response, 200, service.runtime());
        return;
      }
      if (request.method !== "POST") {
        respond(response, 404, { detail: "Not Found" });
        return;
      }
      const body = await jsonBody(request);
      if (path === "/memory/initialize") {
        respond(response, 200, await service.initialize(body));
        return;
      }
      if (path === "/memory/add") {
        respond(response, 200, await service.add(body));
        return;
      }
      if (path === "/memory/wrap_user_prompt") {
        respond(response, 200, await service.wrap(body));
        return;
      }
      respond(response, 404, { detail: "Not Found" });
    } catch (error) {
      const failure = memoryArenaHttpError(error);
      respond(
        response,
        failure.status,
        failure.body,
        failure.retryable,
        failure.code,
      );
    } finally {
      const health = path === "/memory/wrap_user_prompt"
        ? service.health()
        : undefined;
      process.stderr.write(`${JSON.stringify({
        method: request.method,
        path,
        status: response.statusCode,
        duration_ms: Date.now() - started,
        ...(health === undefined ? {} : { load: health }),
      })}\n`);
    }
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      void runtime.close().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.listen(port, host, () => {
    process.stderr.write(`${JSON.stringify({
      event: "listening",
      service: "pimem-memoryarena-public",
      host,
      port,
      memory_system_name: runtime.memorySystemName,
      retrieval_skill: skill,
      runtime_identity_sha256: runtimeIdentity.sha256,
      data_dir: runtime.paths.root,
      load: service.health(),
    })}\n`);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `PiMem MemoryArena Public API failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
