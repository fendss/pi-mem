import { describe, expect, it, vi } from "vitest";
import {
  MemoryArenaPublicApiService,
  MemoryArenaPublicApplication,
  type MemoryArenaPublicBackend,
} from "../src/entrypoints/memoryarena-public-api/application.js";
import {
  parseMemoryArenaAddRequest,
  parseMemoryArenaInitializeRequest,
  parseMemoryArenaWrapRequest,
} from "../src/entrypoints/memoryarena-public-api/contracts.js";

describe("MemoryArena Public official HTTP contract", () => {
  it("accepts and maps the exact initialize/add/wrap payloads", () => {
    expect(parseMemoryArenaInitializeRequest({
      user_id: "user-1",
      memory_system_name: "pimem",
    })).toEqual({ userId: "user-1", memorySystemName: "pimem" });
    expect(parseMemoryArenaAddRequest({
      user_id: "user-1",
      memory_system_name: "pimem",
      chunk: "  exact chunk\n",
    })).toEqual({
      userId: "user-1",
      memorySystemName: "pimem",
      chunk: "  exact chunk\n",
    });
    expect(parseMemoryArenaWrapRequest({
      user_id: "user-1",
      memory_system_name: "pimem",
      question: "What next?",
    })).toEqual({
      userId: "user-1",
      memorySystemName: "pimem",
      question: "What next?",
    });
  });

  it("rejects benchmark labels and every other non-contract field", () => {
    for (const field of ["gold", "answer", "label"]) {
      expect(() => parseMemoryArenaAddRequest({
        user_id: "user-1",
        memory_system_name: "pimem",
        chunk: "memory",
        [field]: "hidden",
      })).toThrow(`unsupported fields: ${field}`);
    }
    expect(() => parseMemoryArenaWrapRequest({
      user_id: "user-1",
      memory_system_name: "pimem",
      question: "question",
      evaluator_state: {},
    })).toThrow("unsupported fields: evaluator_state");
  });

  it("returns byte-compatible success envelopes", async () => {
    const backend: MemoryArenaPublicBackend = {
      initialize: vi.fn(async (input) => ({
        ...input,
        generation: 1,
      })),
      add: vi.fn(async (input) => ({ userId: input.userId, response: null })),
      wrap: vi.fn(async (input) => ({
        userId: input.userId,
        prompt: `<memory_context>\nNone\n</memory_context>\nUser: ${input.question}`,
      })),
    };
    const service = new MemoryArenaPublicApiService(
      new MemoryArenaPublicApplication(backend),
    );

    await expect(service.initialize({
      user_id: "u",
      memory_system_name: "pimem",
    })).resolves.toEqual({
      status: "ok",
      user_id: "u",
      memory_system_name: "pimem",
    });
    await expect(service.add({
      user_id: "u",
      memory_system_name: "pimem",
      chunk: "chunk",
    })).resolves.toEqual({ status: "ok", user_id: "u", response: null });
    await expect(service.wrap({
      user_id: "u",
      memory_system_name: "pimem",
      question: "Q?",
    })).resolves.toEqual({
      status: "ok",
      user_id: "u",
      prompt: "<memory_context>\nNone\n</memory_context>\nUser: Q?",
    });
  });
});
