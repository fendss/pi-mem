import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  FileMemoryArenaGenerationStore,
} from "../adapters/filesystem-generation-store.js";
import {
  JsonlMemoryArenaWrapAuditSink,
} from "../adapters/jsonl-wrap-audit-sink.js";
import {
  JsonlMemoryArenaOperationAuditSink,
} from "../adapters/jsonl-operation-audit-sink.js";
import {
  PiMemMemoryArenaAdapter,
} from "../adapters/pimem-memory-runtime.js";
import {
  MemoryArenaMeasuredEmbedder,
  type MemoryArenaAttemptMeteredEmbedder,
} from "../adapters/measured-embedder.js";
import {
  MEMORYARENA_PUBLIC_MEMORY_SYSTEM,
  MemoryArenaPublicMemoryBackend,
  type MemoryArenaOperationAuditSink,
  type MemoryArenaWrapAuditSink,
} from "../index.js";
import type { PiMemSkill } from "../../../evidence-agent/index.js";
import type { PiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../../../platform/sqlite/pimem-store.js";
import type { RetrievalMetadata } from "../../../retrieval/index.js";
import { createRetrievalContext } from "../../../composition/create-retrieval-context.js";

export interface CreateMemoryArenaPublicRuntimeOptions {
  dataDir: string;
  modelRuntime: PiModelRuntime;
  embedder: MemoryArenaAttemptMeteredEmbedder;
  memorySystemName?: string;
  skill?: PiMemSkill;
  maxRunMs?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  auditSink?: MemoryArenaWrapAuditSink;
  operationAuditSink?: MemoryArenaOperationAuditSink;
}

export interface MemoryArenaPublicRuntime {
  backend: MemoryArenaPublicMemoryBackend;
  memorySystemName: string;
  retrieval: RetrievalMetadata;
  operatorCatalog: ReturnType<
    ReturnType<typeof createRetrievalContext>["operatorRegistry"]["list"]
  >;
  paths: {
    root: string;
    database: string;
    generations: string;
    operationAudits: string;
    wrapAudits: string;
  };
  close(): Promise<void>;
}

export interface MemoryArenaPublicDataDirectoryLease {
  path: string;
  release(): Promise<void>;
}

function fileErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return fileErrorCode(error) !== "ESRCH";
  }
}

/** Prevents independent server processes from corrupting one generation sidecar. */
export async function acquireMemoryArenaPublicDataDirectoryLease(
  dataDir: string,
): Promise<MemoryArenaPublicDataDirectoryLease> {
  const root = resolve(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const path = join(root, ".pimem-memoryarena.lock");
  const token = randomUUID();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({
          schema_version: 1,
          pid: process.pid,
          token,
          created_at: new Date().toISOString(),
        })}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        path,
        release: async () => {
          try {
            const current = JSON.parse(await readFile(path, "utf8")) as {
              token?: unknown;
            };
            if (current.token === token) await unlink(path);
          } catch (error) {
            if (fileErrorCode(error) !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (fileErrorCode(error) !== "EEXIST") throw error;
      let owner: { pid?: unknown };
      try {
        owner = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
      } catch (readError) {
        if (fileErrorCode(readError) === "ENOENT") continue;
        throw new Error(`MemoryArena data directory has an unreadable lock: ${path}`);
      }
      if (
        typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1
      ) {
        throw new Error(`MemoryArena data directory has an invalid lock: ${path}`);
      }
      if (processIsAlive(owner.pid)) {
        throw new Error(
          `MemoryArena data directory is already owned by process ${owner.pid}: ${root}`,
        );
      }
      const stale = `${path}.stale-${randomUUID()}`;
      try {
        await rename(path, stale);
        await unlink(stale);
      } catch (renameError) {
        if (fileErrorCode(renameError) !== "ENOENT") throw renameError;
      }
    }
  }
  throw new Error(`Unable to acquire MemoryArena data directory: ${root}`);
}

/** Wires the official HTTP memory contract to PiMem without benchmark policy. */
export async function createMemoryArenaPublicRuntime(
  options: CreateMemoryArenaPublicRuntimeOptions,
): Promise<MemoryArenaPublicRuntime> {
  const root = resolve(options.dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lease = await acquireMemoryArenaPublicDataDirectoryLease(root);
  const paths = {
    root,
    database: join(root, "memory.sqlite"),
    generations: join(root, "active-generations.json"),
    operationAudits: join(root, "operation-audits.jsonl"),
    wrapAudits: join(root, "wrap-audits.jsonl"),
  };
  let rawStore: MemoryStore | undefined;
  try {
    rawStore = await MemoryStore.create(paths.database);
    const measuredEmbedder = new MemoryArenaMeasuredEmbedder(options.embedder);
    const retrieval = createRetrievalContext(
      rawStore,
      "pimem-hybrid",
      measuredEmbedder,
    );
    const generations = new FileMemoryArenaGenerationStore(paths.generations);
    const fileAudits = options.auditSink === undefined
      ? new JsonlMemoryArenaWrapAuditSink(paths.wrapAudits)
      : undefined;
    const audits = options.auditSink ?? fileAudits!;
    const fileOperationAudits = options.operationAuditSink === undefined
      ? new JsonlMemoryArenaOperationAuditSink(paths.operationAudits)
      : undefined;
    const operationAudits = options.operationAuditSink ?? fileOperationAudits!;
    const memory = new PiMemMemoryArenaAdapter({
      rawStore,
      runtimeStore: retrieval.store,
      operatorRegistry: retrieval.operatorRegistry,
      embedder: measuredEmbedder,
      modelRuntime: options.modelRuntime,
      ...(options.skill === undefined ? {} : { skill: options.skill }),
      ...(options.maxRunMs === undefined ? {} : { maxRunMs: options.maxRunMs }),
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.maxToolCalls === undefined
        ? {}
        : { maxToolCalls: options.maxToolCalls }),
    });
    const memorySystemName =
      options.memorySystemName ?? MEMORYARENA_PUBLIC_MEMORY_SYSTEM;
    const backend = new MemoryArenaPublicMemoryBackend({
      generations,
      chunks: memory,
      retriever: memory,
      audits,
      operationAudits,
      embeddingMeter: measuredEmbedder,
      memorySystemName,
    });
    let closed = false;
    return {
      backend,
      memorySystemName,
      retrieval: retrieval.metadata,
      operatorCatalog: retrieval.operatorRegistry.list(),
      paths,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await Promise.all([
            fileAudits?.flush(),
            fileOperationAudits?.flush(),
          ]);
        } finally {
          try {
            rawStore!.close();
          } finally {
            await lease.release();
          }
        }
      },
    };
  } catch (error) {
    try {
      rawStore?.close();
    } finally {
      await lease.release();
    }
    throw error;
  }
}
