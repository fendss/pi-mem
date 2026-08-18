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
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "mock-provider",
    model: "mock-model",
    responseModel: "mock-model",
    usage: ZERO_USAGE,
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
      }], "toolUse"),
      assistantMessage([{
        type: "toolCall",
        id: "read-1",
        name: "read",
        arguments: { candidateRefs: [1], contextBefore: 0, contextAfter: 0 },
      }], "toolUse"),
      assistantMessage([{
        type: "toolCall",
        id: "finish-1",
        name: "finish",
        arguments: {
          status: "sufficient",
          citations: [{ candidateRef: 1, supports: "The bicycle is blue." }],
          evidenceSummary: "The user's bicycle is blue.",
        },
      }], "toolUse"),
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
    expect(answerPrompts).toHaveLength(1);
    expect(answer.answer).toBe("Blue.");
  });
});
