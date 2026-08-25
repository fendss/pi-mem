import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  MEMORYARENA_PUBLIC_MEMORY_SYSTEM,
  MemoryArenaPublicError,
} from "../../benchmark/memoryarena-public/index.js";
import { createMemoryArenaPublicRuntime } from "../../benchmark/memoryarena-public/composition/create-runtime.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
} from "../../platform/pi/load-model-runtime.js";
import { OpenAICompatibleEmbedder } from "../../retrieval/adapters/openai/openai-compatible-embedder.js";
import {
  MemoryArenaPublicApiService,
  MemoryArenaPublicApplication,
} from "./application.js";

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
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(retryable
      ? { "retry-after": "5", "x-pimem-retryable": "true" }
      : {}),
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function main(): Promise<void> {
  const dataDir = resolve(
    process.env.PIMEM_DATA_DIR?.trim() || "./data/memoryarena-public",
  );
  const modelRuntime = await loadPiModelRuntime({
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
  const embedder = OpenAICompatibleEmbedder.fromEnvironment();
  const runtime = await createMemoryArenaPublicRuntime({
    dataDir,
    modelRuntime,
    embedder,
    memorySystemName:
      process.env.PIMEM_MEMORY_SYSTEM_NAME?.trim() ||
      MEMORYARENA_PUBLIC_MEMORY_SYSTEM,
    maxRunMs: integerEnvironment("PIMEM_MAX_RUN_MS", 300_000, 1_800_000),
    maxTurns: integerEnvironment("PIMEM_MAX_TURNS", 64, 256),
    maxToolCalls: integerEnvironment("PIMEM_MAX_TOOL_CALLS", 80, 512),
  });
  const service = new MemoryArenaPublicApiService(
    new MemoryArenaPublicApplication(runtime.backend),
  );
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = integerEnvironment("PORT", 3111, 65_535);
  const server = createServer(async (request, response) => {
    const started = Date.now();
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
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
      if (error instanceof MemoryArenaPublicError) {
        respond(
          response,
          error.httpStatus,
          { detail: error.message },
          error.retryable,
        );
      } else {
        respond(response, 500, { detail: "Internal Server Error" });
      }
    } finally {
      process.stderr.write(`${JSON.stringify({
        method: request.method,
        path,
        status: response.statusCode,
        duration_ms: Date.now() - started,
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
      data_dir: runtime.paths.root,
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
