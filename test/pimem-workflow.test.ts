import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { runBenchmarkAnswer } from "../src/benchmark/answer-from-evidence.js";
import { buildLongMemEvalAnswerPrompt } from "../src/benchmark/longmemeval/dataset-adapter.js";
import { createSearchOperatorRegistry } from "../src/composition/create-search-operator-registry.js";
import {
  PIMEM_SKILL_TEXT,
  runPiMem,
  type PiMemRuntimeStore,
} from "../src/evidence-agent/index.js";
import type { MemoryRecord } from "../src/memory/index.js";
import type { PiModelRuntime } from "../src/platform/pi/load-model-runtime.js";

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  usage: AssistantMessage["usage"] = ZERO_USAGE,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "mock-provider",
    model: "mock-model",
    responseModel: "mock-model",
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function scriptedRuntime(
  messages: readonly AssistantMessage[],
  observedSystemPrompts: string[],
): PiModelRuntime {
  let next = 0;
  return {
    modelAdapterId: "test-adapter",
    providerId: "mock-provider",
    modelId: "mock-model",
    thinkingLevel: "off",
    transport: "sse",
    model: {
      id: "mock-model",
      name: "Mock model",
      api: "openai-completions",
      provider: "mock-provider",
      baseUrl: "http://127.0.0.1:1/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_384,
      maxTokens: 1_024,
    },
    streamFn: (_model, context) => {
      observedSystemPrompts.push(context.systemPrompt ?? "");
      const message = messages[next++];
      if (message === undefined) {
        throw new Error("Mock provider script was exhausted");
      }
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({
          type: "done",
          reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
          message,
        });
      });
      return stream;
    },
    getApiKey: async () => "mock-key",
  };
}

describe("PiMem offline workflow", () => {
  it("executes search -> read -> finish -> answer with one injected Skill", async () => {
    const memory: MemoryRecord = {
      memoryId: "memory-blue",
      scopeId: "scope-1",
      sessionId: "session-1",
      turnIndex: 0,
      role: "user",
      content: "My bicycle is blue.",
      contentHash: "hash-blue",
      metadata: {},
    };
    const store: PiMemRuntimeStore = {
      search(_scopeId, request) {
        return [{
          record: memory,
          query: request.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: memory.content,
        }];
      },
      read(_scopeId, memoryIds) {
        return memoryIds.includes(memory.memoryId) ? [memory] : [];
      },
      findMentionedMemoryIds() {
        return [];
      },
      getRecords(_scopeId, memoryIds) {
        return memoryIds.includes(memory.memoryId) ? [memory] : [];
      },
    };
    const retrievalPrompts: string[] = [];
    const retrievalRuntime = scriptedRuntime([
      assistantMessage([{
        type: "toolCall",
        id: "search-1",
        name: "search",
        arguments: {
          operator: "lexical",
          queries: ["bicycle blue"],
          limit: 5,
        },
      }], "toolUse", {
        input: 10,
        output: 2,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 13,
        cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 0, total: 4 },
      }),
      assistantMessage([{
        type: "toolCall",
        id: "read-1",
        name: "read",
        arguments: { candidateRefs: [1], contextBefore: 0, contextAfter: 0 },
      }], "toolUse", {
        input: 20,
        output: 3,
        cacheRead: 2,
        cacheWrite: 1,
        reasoning: 1,
        totalTokens: 26,
        cost: { input: 2, output: 3, cacheRead: 2, cacheWrite: 4, total: 11 },
      }),
      assistantMessage([{
        type: "toolCall",
        id: "finish-1",
        name: "finish",
        arguments: {
          status: "sufficient",
          citations: [{ candidateRef: 1, supports: "The bicycle is blue." }],
          evidenceSummary: "The user's bicycle is blue.",
        },
      }], "toolUse", {
        input: 30,
        output: 4,
        cacheRead: 3,
        cacheWrite: 2,
        cacheWrite1h: 1,
        reasoning: 2,
        totalTokens: 39,
        cost: { input: 3, output: 4, cacheRead: 3, cacheWrite: 8, total: 18 },
      }),
    ], retrievalPrompts);

    const retrieval = await runPiMem({
      store,
      operatorRegistry: createSearchOperatorRegistry(store),
      modelRuntime: retrievalRuntime,
      scopeId: "scope-1",
      question: "What color is my bicycle?",
      skill: "pimem-v0",
    });

    const answerPrompts: string[] = [];
    const answerRuntime = scriptedRuntime([
      assistantMessage([{ type: "text", text: "Blue." }], "stop"),
    ], answerPrompts);
    const answer = await runBenchmarkAnswer({
      modelRuntime: answerRuntime,
      prompt: buildLongMemEvalAnswerPrompt(
        "What color is my bicycle?",
        retrieval,
      ),
    });

    expect(retrievalPrompts).toHaveLength(3);
    expect(retrievalPrompts[0]).toContain(PIMEM_SKILL_TEXT);
    expect(retrievalPrompts[0]?.match(/<active_skill/gu)).toHaveLength(1);
    expect(retrieval.trace.map((item) => item.toolName)).toEqual([
      "search",
      "read",
      "finish",
    ]);
    expect(retrieval.metrics).toMatchObject({
      searchCalls: 1,
      readCalls: 1,
      candidateCount: 1,
      evidenceCount: 1,
      citedCount: 1,
    });
    expect(retrieval.citations.map((item) => item.memoryId)).toEqual([
      memory.memoryId,
    ]);
    expect(retrieval.evidence.map((item) => item.memoryId)).toContain(
      memory.memoryId,
    );
    expect(retrieval.usage).toEqual({
      input: 60,
      output: 9,
      cacheRead: 6,
      cacheWrite: 3,
      cacheWrite1h: 1,
      reasoning: 3,
      totalTokens: 78,
      cost: {
        input: 6,
        output: 9,
        cacheRead: 6,
        cacheWrite: 12,
        total: 33,
      },
    });
    expect(answerPrompts).toHaveLength(1);
    expect(answer.answer).toBe("Blue.");
  });

  it("defines a run-local operator and uses it without mutating the base registry", async () => {
    const memory: MemoryRecord = {
      memoryId: "memory-runtime-operator",
      scopeId: "scope-1",
      sessionId: "session-1",
      turnIndex: 0,
      role: "user",
      content: "The migration codename is Cedar.",
      contentHash: "hash-cedar",
      metadata: {},
    };
    const store: PiMemRuntimeStore = {
      search(_scopeId, request) {
        return [{
          record: memory,
          query: request.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: memory.content,
        }];
      },
      read: () => [memory],
      findMentionedMemoryIds: () => [],
      getRecords: () => [memory],
    };
    const registry = createSearchOperatorRegistry(store);
    const runtime = scriptedRuntime([
      assistantMessage([{
        type: "toolCall",
        id: "define-1",
        name: "define_operator",
        arguments: {
          id: "dual-recall",
          summary: "Fuse exact and semantic recall.",
          sources: [
            { operator: "lexical", limit: 5 },
            { operator: "hybrid", limit: 5 },
          ],
          combine: "rrf",
        },
      }], "toolUse"),
      assistantMessage([{
        type: "toolCall",
        id: "search-1",
        name: "search",
        arguments: {
          operator: "dual-recall",
          queries: ["migration codename"],
          limit: 5,
        },
      }], "toolUse"),
      assistantMessage([{
        type: "toolCall",
        id: "read-1",
        name: "read",
        arguments: { candidateRefs: [1] },
      }], "toolUse"),
      assistantMessage([{
        type: "toolCall",
        id: "finish-1",
        name: "finish",
        arguments: {
          status: "sufficient",
          citations: [{ candidateRef: 1, supports: "The codename is Cedar." }],
          evidenceSummary: "The migration codename is Cedar.",
        },
      }], "toolUse"),
    ], []);

    const result = await runPiMem({
      store,
      operatorRegistry: registry,
      modelRuntime: runtime,
      scopeId: "scope-1",
      question: "What is the migration codename?",
    });

    expect(result.trace.map((item) => item.toolName)).toEqual([
      "define_operator",
      "search",
      "read",
      "finish",
    ]);
    expect(result.trace[1]?.details).toMatchObject({
      operator: "dual-recall",
      composition: { definitionRevision: 1 },
    });
    expect(result.operatorCatalog).toMatchObject({ revision: 1 });
    expect(result.operatorDefinitions).toEqual([
      expect.objectContaining({
        revision: 1,
        definition: expect.objectContaining({ id: "dual-recall" }),
      }),
    ]);
    expect(result.metrics.operatorDefinitionCalls).toBe(1);
    expect(() => registry.get("dual-recall")).toThrow(/unknown/iu);

    const replayPrompts: string[] = [];
    const replay = await runPiMem({
      store,
      operatorRegistry: registry,
      operatorDefinitions: result.operatorDefinitions!.map(
        (snapshot) => snapshot.definition,
      ),
      modelRuntime: scriptedRuntime([
        assistantMessage([{
          type: "toolCall",
          id: "search-2",
          name: "search",
          arguments: {
            operator: "dual-recall",
            queries: ["migration codename"],
            limit: 5,
          },
        }], "toolUse"),
        assistantMessage([{
          type: "toolCall",
          id: "read-2",
          name: "read",
          arguments: { candidateRefs: [1] },
        }], "toolUse"),
        assistantMessage([{
          type: "toolCall",
          id: "finish-2",
          name: "finish",
          arguments: {
            status: "sufficient",
            citations: [{ candidateRef: 1, supports: "The codename is Cedar." }],
            evidenceSummary: "The migration codename is Cedar.",
          },
        }], "toolUse"),
      ], replayPrompts),
      scopeId: "scope-1",
      question: "What is the migration codename?",
    });

    expect(replayPrompts[0]).toContain("dual-recall@run-1");
    expect(replay.trace.map((item) => item.toolName)).toEqual([
      "search",
      "read",
      "finish",
    ]);
    expect(replay.operatorCatalog).toEqual(result.operatorCatalog);
    expect(replay.metrics.operatorDefinitionCalls).toBe(0);
  });
});
