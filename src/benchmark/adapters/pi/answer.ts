import { Agent } from "@earendil-works/pi-agent-core";
import type { PiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import {
  assistantMessageText,
  lastAssistantMessage,
} from "../../../evidence-agent/index.js";
import {
  assertNonEmpty,
  newRunId,
  sha256,
} from "../../../util.js";
import {
  returnedModelMatches,
  type BenchmarkAnswerPrompt,
  type BenchmarkAnswerResult,
} from "../../model/answer.js";

/** Runs benchmark-owned answer synthesis after PiMem has finished retrieval. */
function answerSystemPrompt(
  prompt: BenchmarkAnswerPrompt,
  executionChecklist?: string,
): string {
  return [prompt.systemPrompt.trim(), executionChecklist?.trim()]
    .filter(Boolean)
    .join("\n\n");
}

export async function runBenchmarkAnswer(options: {
  modelRuntime: PiModelRuntime;
  prompt: BenchmarkAnswerPrompt;
  maxRunMs?: number;
  executionChecklist?: string;
}): Promise<BenchmarkAnswerResult> {
  const maxRunMs = options.maxRunMs ?? 120_000;
  const agent = new Agent({
    initialState: {
      systemPrompt: answerSystemPrompt(
        options.prompt,
        options.executionChecklist,
      ),
      model: options.modelRuntime.model,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      tools: [],
    },
    streamFn: (model, context, streamOptions) =>
      options.modelRuntime.streamFn(model, context, {
        ...streamOptions,
        temperature: 0,
      }),
    getApiKey: options.modelRuntime.getApiKey,
    sessionId: newRunId(),
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, maxRunMs);
  timer.unref();
  try {
    await agent.prompt(assertNonEmpty(options.prompt.userPrompt, "answer prompt"));
  } finally {
    clearTimeout(timer);
  }
  const message = lastAssistantMessage(agent.state.messages);
  if (timedOut) {
    throw new Error(`Benchmark answer stage exceeded ${maxRunMs}ms`);
  }
  if (!message) throw new Error("Benchmark answer stage returned no assistant message");
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(
      message.errorMessage ??
        `Benchmark answer stage stopped with ${message.stopReason}`,
    );
  }
  const answer = assistantMessageText(message).trim();
  if (!answer) throw new Error("Benchmark answer stage returned empty text");
  const responseModel = message.responseModel ?? message.model;
  if (!returnedModelMatches(options.modelRuntime.modelId, responseModel)) {
    throw new Error(
      `Benchmark answer provider substituted model ${responseModel}; expected ${options.modelRuntime.modelId}`,
    );
  }
  return {
    answer,
    promptAdapter: options.prompt.adapterId,
    promptVersion: options.prompt.promptVersion,
    promptHash: sha256(
      `${answerSystemPrompt(options.prompt, options.executionChecklist)}\0${options.prompt.userPrompt}`,
    ),
    model: {
      providerId: options.modelRuntime.providerId,
      modelId: options.modelRuntime.modelId,
      responseModels: [responseModel],
      thinkingLevel: options.modelRuntime.thinkingLevel,
      transport: options.modelRuntime.transport,
      responseModel,
    },
    usage: message.usage,
  };
}
