import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  interactiveMemorySystemPrompt,
  InteractiveMemoryAgentSession,
  PIMEM_ACTION_SKILL_TEXT,
} from "../src/agent-runtime/index.js";
import { createSelectedSearchOperatorRegistry } from "../src/composition/create-search-operator-registry.js";
import type { PiMemRuntimeStore } from "../src/evidence-agent/index.js";
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

function message(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "mock-provider",
    model: "mock-model",
    responseModel: "mock-model-2026-08-20",
    usage: ZERO_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

function scriptedRuntime(
  script: readonly AssistantMessage[],
  prompts: string[],
  histories: string[] = [],
): PiModelRuntime {
  let index = 0;
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
      maxTokens: 2_048,
    },
    streamFn: (_model, context) => {
      prompts.push(context.systemPrompt ?? "");
      histories.push(JSON.stringify(context.messages));
      const next = script[index++];
      if (next === undefined) throw new Error("Mock script exhausted");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: next });
        stream.push({
          type: "done",
          reason: next.stopReason === "toolUse" ? "toolUse" : "stop",
          message: next,
        });
      });
      return stream;
    },
    getApiKey: async () => "mock-key",
  };
}

describe("interactive PiMem agent runtime", () => {
  it("reports the PiMem turn budget instead of a generic benchmark abort", async () => {
    const store: PiMemRuntimeStore = {
      search: () => [],
      read: () => [],
      findMentionedMemoryIds: () => [],
      getRecords: () => [],
    };
    const runtime = scriptedRuntime([
      message([{
        type: "toolCall",
        id: "search-1",
        name: "search",
        arguments: { operator: "lexical", queries: ["first"] },
      }], "toolUse"),
      message([{
        type: "toolCall",
        id: "search-2",
        name: "search",
        arguments: { operator: "lexical", queries: ["second"] },
      }], "toolUse"),
    ], []);
    const session = new InteractiveMemoryAgentSession({
      store,
      operatorRegistry: createSelectedSearchOperatorRegistry(store, ["lexical"]),
      modelRuntime: runtime,
      scopeId: "tau-scope",
      domainPolicy: "Policy",
      externalTools: [],
      maxTurnsPerInput: 1,
    });

    await expect(session.turn({ type: "user", content: "Find the policy." }))
      .rejects.toThrow("Interactive PiMem exceeded its per-input turn budget (1)");
  });

  it("keeps retrieval inside the reasoning loop and forwards only domain actions", async () => {
    const document: MemoryRecord = {
      memoryId: "policy-blue",
      scopeId: "tau-scope",
      sessionId: "doc-blue",
      turnIndex: 0,
      role: "other",
      content: "# Blue card policy\n\nThe daily limit is $300.",
      contentHash: "hash-blue",
      metadata: {},
    };
    const store: PiMemRuntimeStore = {
      search(_scopeId, request) {
        return [{
          record: document,
          query: request.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: document.content,
        }];
      },
      read(_scopeId, memoryIds) {
        return memoryIds.includes(document.memoryId) ? [document] : [];
      },
      findMentionedMemoryIds() {
        return [];
      },
      getRecords(_scopeId, memoryIds) {
        return memoryIds.includes(document.memoryId) ? [document] : [];
      },
    };
    const prompts: string[] = [];
    const runtime = scriptedRuntime([
      message([{
        type: "toolCall",
        id: "define-1",
        name: "define_operator",
        arguments: {
          id: "policy-recall",
          summary: "Fuse exact and semantic policy recall.",
          sources: [{ operator: "lexical" }, { operator: "hybrid" }],
          combine: "rrf",
        },
      }], "toolUse"),
      message([{
        type: "toolCall",
        id: "search-1",
        name: "search",
        arguments: {
          operator: "policy-recall",
          queries: ["Blue card daily limit"],
          limit: 5,
        },
      }], "toolUse"),
      message([{
        type: "toolCall",
        id: "read-1",
        name: "read",
        arguments: {
          candidateRefs: [1],
          contextBefore: 0,
          contextAfter: 0,
        },
      }], "toolUse"),
      message([{
        type: "toolCall",
        id: "action-1",
        name: "set_daily_limit",
        arguments: { amount: 300 },
      }], "toolUse"),
      message([{ type: "text", text: "Your daily limit is now $300." }], "stop"),
    ], prompts);
    const registry = createSelectedSearchOperatorRegistry(
      store,
      ["hybrid", "lexical", "coverage"],
    );
    const session = new InteractiveMemoryAgentSession({
      store,
      operatorRegistry: registry,
      modelRuntime: runtime,
      scopeId: "tau-scope",
      domainPolicy: "Follow banking policy and use tools for state changes.",
      externalTools: [{
        name: "set_daily_limit",
        description: "Set the account daily limit.",
        parameters: {
          type: "object",
          properties: { amount: { type: "number" } },
          required: ["amount"],
          additionalProperties: false,
        },
      }],
      skill: "pimem-v0",
    });

    const action = await session.turn({
      type: "user",
      content: "Set the Blue card daily limit to the permitted maximum.",
    });
    expect(action.content).toBeNull();
    expect(action.toolCalls).toEqual([{
      id: "action-1",
      name: "set_daily_limit",
      arguments: { amount: 300 },
    }]);
    expect(action.audit.trace.map((entry) => entry.toolName)).toEqual([
      "define_operator",
      "search",
      "read",
      "set_daily_limit",
    ]);
    expect(action.audit).toMatchObject({
      candidateCount: 1,
      evidenceCount: 1,
      skill: { mode: "pimem-v0" },
      operatorCatalog: { revision: 1 },
    });
    expect(prompts[0]).toContain(PIMEM_ACTION_SKILL_TEXT);
    expect(prompts[0]).toContain("lexical@1");
    expect(() => registry.get("policy-recall")).toThrow(/unknown/iu);

    const final = await session.turn({
      type: "tool-results",
      results: [{
        toolCallId: "action-1",
        toolName: "set_daily_limit",
        content: "Limit updated successfully.",
        isError: false,
      }],
    });
    expect(final.toolCalls).toEqual([]);
    expect(final.content).toBe("Your daily limit is now $300.");
  });

  it("keeps the bare-tools arm identical except for the action Skill suffix", () => {
    const store: PiMemRuntimeStore = {
      search: () => [],
      read: () => [],
      findMentionedMemoryIds: () => [],
      getRecords: () => [],
    };
    const registry = createSelectedSearchOperatorRegistry(store, ["hybrid"]);
    const common = {
      domainPolicy: "Policy",
      operatorRegistry: registry,
    };
    const baseline = interactiveMemorySystemPrompt({
      ...common,
      skill: "none",
    });
    const treatment = interactiveMemorySystemPrompt({
      ...common,
      skill: "pimem-v0",
    });

    expect(baseline).not.toContain("<active_skill");
    expect(treatment).toBe(`${baseline}\n\n<active_skill name="pimem-knowledge-action" version="pimem-knowledge-action-v3">\n${PIMEM_ACTION_SKILL_TEXT}\n</active_skill>`);
  });

  it("preserves the official initial assistant greeting before the first user turn", async () => {
    const store: PiMemRuntimeStore = {
      search: () => [],
      read: () => [],
      findMentionedMemoryIds: () => [],
      getRecords: () => [],
    };
    const histories: string[] = [];
    const runtime = scriptedRuntime([
      message([{ type: "text", text: "How can I help?" }], "stop"),
    ], [], histories);
    const session = new InteractiveMemoryAgentSession({
      store,
      operatorRegistry: createSelectedSearchOperatorRegistry(store, ["lexical"]),
      modelRuntime: runtime,
      scopeId: "tau-scope",
      domainPolicy: "Policy",
      externalTools: [],
      initialAssistantMessage: "Hi! How can I help you today?",
      skill: "none",
    });

    await session.turn({ type: "user", content: "I need help." });

    expect(histories).toHaveLength(1);
    expect(histories[0]).toContain("Hi! How can I help you today?");
    expect(histories[0]).toContain("I need help.");
    expect(histories[0]!.indexOf("Hi! How can I help you today?")).toBeLessThan(
      histories[0]!.indexOf("I need help."),
    );
  });
});
