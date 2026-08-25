import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileMemoryArenaGenerationStore } from "../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.js";
import {
  MemoryArenaPublicError,
  MemoryArenaPublicMemoryBackend,
  type MemoryArenaChunkMemory,
  type MemoryArenaEmbeddingOperationMeter,
  type MemoryArenaEvidenceRetriever,
  type MemoryArenaOriginalChunk,
  type MemoryArenaOperationAuditSink,
  type MemoryArenaWrapAuditRecord,
  type MemoryArenaWrapAuditSink,
} from "../src/benchmark/memoryarena-public/index.js";

const temporaryDirectories: string[] = [];
const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const NOOP_OPERATION_AUDITS: MemoryArenaOperationAuditSink = {
  begin: async () => ({
    succeed: async () => undefined,
    fail: async () => undefined,
  }),
};
const NOOP_EMBEDDING_METER: MemoryArenaEmbeddingOperationMeter = {
  measureOperation: async (operation) => ({
    result: await operation(),
    embedding: {
      measurement: "async_context",
      delta: { calls: 0, latencyMs: 0, inputTokens: 0, usageMissingCalls: 0 },
    },
  }),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pimem-memoryarena-state-"));
  temporaryDirectories.push(directory);
  return join(directory, "active-generations.json");
}

class MockChunks implements MemoryArenaChunkMemory {
  readonly appends: Array<{
    userId: string;
    generation: number;
    ordinal: number;
    chunk: string;
  }> = [];
  readonly chunks = new Map<string, string>();

  async appendOriginalChunk(options: {
    userId: string;
    generation: number;
    ordinal: number;
    chunk: string;
  }): Promise<void> {
    this.appends.push({ ...options });
    this.chunks.set(`m-${options.generation}-${options.ordinal}`, options.chunk);
  }

  async readOriginalChunks(options: {
    memoryIds: readonly string[];
  }): Promise<MemoryArenaOriginalChunk[]> {
    return options.memoryIds.flatMap((memoryId) => {
      const content = this.chunks.get(memoryId);
      return content === undefined ? [] : [{ memoryId, content }];
    });
  }
}

class RecordingAudits implements MemoryArenaWrapAuditSink {
  readonly records: MemoryArenaWrapAuditRecord[] = [];
  async record(record: MemoryArenaWrapAuditRecord): Promise<void> {
    this.records.push(record);
  }
}

describe("MemoryArena Public memory lifecycle", () => {
  it("starts empty, preserves raw chunks, and renders only cited/inventory sources", async () => {
    const chunks = new MockChunks();
    const audits = new RecordingAudits();
    const retriever: MemoryArenaEvidenceRetriever = {
      retrieve: vi.fn(async () => chunks.appends.length === 2
        ? {
            runId: "run-1",
            status: "sufficient" as const,
            citations: [{ memoryId: "m-1-1", supports: "direct" }],
            inventory: [{ item: "first", memoryIds: ["m-1-0", "m-1-1"] }],
            trace: [{ toolName: "search" }, { toolName: "read" }],
            usage: {
              ...ZERO_USAGE,
              input: 40,
              output: 2,
              totalTokens: 42,
            },
            audit: { evidence_summary: "must not be rendered" },
          }
        : {
            runId: "run-2",
            status: "sufficient" as const,
            citations: [{ memoryId: "m-1-2", supports: "new evidence" }],
            trace: [{ toolName: "search" }],
            usage: ZERO_USAGE,
          }),
    };
    const backend = new MemoryArenaPublicMemoryBackend({
      generations: new FileMemoryArenaGenerationStore(await statePath()),
      chunks,
      retriever,
      audits,
      operationAudits: NOOP_OPERATION_AUDITS,
      embeddingMeter: NOOP_EMBEDDING_METER,
      memorySystemName: "pimem",
    });
    await backend.initialize({ userId: "u", memorySystemName: "pimem" });
    await expect(backend.wrap({
      userId: "u",
      memorySystemName: "pimem",
      question: "Empty?",
    })).resolves.toEqual({
      userId: "u",
      prompt: "<memory_context>\nNone\n</memory_context>\nUser: Empty?",
    });
    expect(retriever.retrieve).not.toHaveBeenCalled();

    await backend.add({
      userId: "u",
      memorySystemName: "pimem",
      chunk: "  first raw chunk\n",
    });
    await backend.add({
      userId: "u",
      memorySystemName: "pimem",
      chunk: "second <raw> chunk",
    });
    expect(chunks.appends).toEqual([
      { userId: "u", generation: 1, ordinal: 0, chunk: "  first raw chunk\n" },
      { userId: "u", generation: 1, ordinal: 1, chunk: "second <raw> chunk" },
    ]);

    const wrapped = await backend.wrap({
      userId: "u",
      memorySystemName: "pimem",
      question: "Which chunks?",
    });
    expect(wrapped.prompt).toBe([
      "<memory_context>",
      "<memory>second <raw> chunk</memory>",
      "<memory>  first raw chunk\n</memory>",
      "</memory_context>",
      "User: Which chunks?",
    ].join("\n"));
    expect(wrapped.prompt).not.toContain("must not be rendered");
    expect(audits.records.at(-1)).toMatchObject({
      generation: 1,
      nextOrdinal: 2,
      selectedMemoryIds: ["m-1-1", "m-1-0"],
      retrieval: { usage: { input: 40, output: 2, totalTokens: 42 } },
    });

    await backend.add({
      userId: "u",
      memorySystemName: "pimem",
      chunk: "third chunk added after wrap",
    });
    await expect(backend.wrap({
      userId: "u",
      memorySystemName: "pimem",
      question: "What was added later?",
    })).resolves.toEqual({
      userId: "u",
      prompt: [
        "<memory_context>",
        "<memory>third chunk added after wrap</memory>",
        "</memory_context>",
        "User: What was added later?",
      ].join("\n"),
    });
    expect(retriever.retrieve).toHaveBeenCalledTimes(2);
    expect(audits.records.at(-1)).toMatchObject({
      generation: 1,
      nextOrdinal: 3,
      selectedMemoryIds: ["m-1-2"],
    });
  });

  it("creates a clean generation on every repeated initialize", async () => {
    const chunks = new MockChunks();
    const retriever: MemoryArenaEvidenceRetriever = {
      retrieve: async () => ({
        runId: "unused",
        status: "insufficient",
        citations: [],
        trace: [],
        usage: ZERO_USAGE,
      }),
    };
    const backend = new MemoryArenaPublicMemoryBackend({
      generations: new FileMemoryArenaGenerationStore(await statePath()),
      chunks,
      retriever,
      audits: new RecordingAudits(),
      operationAudits: NOOP_OPERATION_AUDITS,
      embeddingMeter: NOOP_EMBEDDING_METER,
      memorySystemName: "pimem",
    });
    expect((await backend.initialize({
      userId: "u",
      memorySystemName: "pimem",
    })).generation).toBe(1);
    await backend.add({ userId: "u", memorySystemName: "pimem", chunk: "old" });
    expect((await backend.initialize({
      userId: "u",
      memorySystemName: "pimem",
    })).generation).toBe(2);
    await backend.add({ userId: "u", memorySystemName: "pimem", chunk: "new" });
    expect(chunks.appends.at(-1)).toEqual({
      userId: "u",
      generation: 2,
      ordinal: 0,
      chunk: "new",
    });
  });

  it("preserves active generation, ordinal, and pending append across restart", async () => {
    const path = await statePath();
    const first = new FileMemoryArenaGenerationStore(path);
    await first.initialize("u", "pimem");
    expect(await first.reserveAppend({ userId: "u", generation: 1, chunk: "a" }))
      .toBe(0);

    const restartedPending = new FileMemoryArenaGenerationStore(path);
    expect(await restartedPending.reserveAppend({
      userId: "u",
      generation: 1,
      chunk: "a",
    })).toBe(0);
    await expect(restartedPending.reserveAppend({
      userId: "u",
      generation: 1,
      chunk: "different",
    })).rejects.toMatchObject({ retryable: true, code: "append_pending" });
    await restartedPending.completeAppend({
      userId: "u",
      generation: 1,
      ordinal: 0,
      chunk: "a",
    });

    const restartedComplete = new FileMemoryArenaGenerationStore(path);
    await expect(restartedComplete.get("u")).resolves.toMatchObject({
      generation: 1,
      nextOrdinal: 1,
    });
    await expect(restartedComplete.initialize("u", "pimem")).resolves.toMatchObject({
      generation: 2,
      nextOrdinal: 0,
    });
  });

  it("matches official uninitialized and mismatched-system errors", async () => {
    const backend = new MemoryArenaPublicMemoryBackend({
      generations: new FileMemoryArenaGenerationStore(await statePath()),
      chunks: new MockChunks(),
      retriever: { retrieve: async () => ({
        runId: "unused", status: "insufficient", citations: [], trace: [],
        usage: ZERO_USAGE,
      }) },
      audits: new RecordingAudits(),
      operationAudits: NOOP_OPERATION_AUDITS,
      embeddingMeter: NOOP_EMBEDDING_METER,
      memorySystemName: "pimem",
    });
    await expect(backend.wrap({
      userId: "missing",
      memorySystemName: "wrong",
      question: "Q",
    })).rejects.toMatchObject({ httpStatus: 404, message: "User not initialized" });
    await backend.initialize({ userId: "u", memorySystemName: "pimem" });
    await expect(backend.add({
      userId: "u",
      memorySystemName: "wrong",
      chunk: "x",
    })).rejects.toMatchObject({
      httpStatus: 400,
      message: "Mismatched memory_system for user",
    });
    await expect(backend.initialize({
      userId: "u",
      memorySystemName: "wrong",
    })).rejects.toBeInstanceOf(MemoryArenaPublicError);
  });
});
