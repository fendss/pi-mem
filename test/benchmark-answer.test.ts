import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  returnedModelMatches,
  runBenchmarkAnswer,
} from "../src/benchmark-answer.js";
import type { PiModelRuntime } from "../src/model.js";

describe("benchmark answer boundary", () => {
  it("accepts dated deployments of the requested model", () => {
    expect(
      returnedModelMatches("gpt-4o-mini", "gpt-4o-mini-2024-07-18"),
    ).toBe(true);
  });

  it("rejects provider model substitution", () => {
    expect(
      returnedModelMatches("gpt-4o-mini", "gpt-4.1-mini-2025-04-14"),
    ).toBe(false);
  });

  it("forces deterministic sampling only at the answer boundary", async () => {
    let streamOptions: SimpleStreamOptions | undefined;
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Answer" }],
      api: "openai-completions",
      provider: "test-provider",
      model: "gpt-4o-mini",
      responseModel: "gpt-4o-mini-2024-07-18",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } satisfies AssistantMessage;
    const runtime = {
      providerId: "test-provider",
      modelId: "gpt-4o-mini",
      thinkingLevel: "off",
      transport: "sse",
      model: {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        api: "openai-completions",
        provider: "test-provider",
        baseUrl: "https://provider.example/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      streamFn: (_model, _context, options) => {
        streamOptions = options;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "stop", message });
        });
        return stream;
      },
      getApiKey: async () => "test-key",
    } satisfies PiModelRuntime;

    const result = await runBenchmarkAnswer({
      modelRuntime: runtime,
      prompt: {
        adapterId: "longmemeval-s",
        promptVersion: "test",
        systemPrompt: "",
        userPrompt: "Question",
      },
    });

    expect(streamOptions?.temperature).toBe(0);
    expect(result.answer).toBe("Answer");
  });
});
