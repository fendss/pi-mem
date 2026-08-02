import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  assertRequestedResponseModel,
  type PiModelRuntime,
} from "./model.js";
export { returnedModelMatches } from "./model.js";
import type { ModelMetadata } from "./types.js";
import { assertNonEmpty, newRunId, sha256 } from "./util.js";

export interface BenchmarkAnswerPrompt {
  adapterId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface BenchmarkAnswerResult {
  answer: string;
  promptAdapter: string;
  promptVersion: string;
  promptHash: string;
  model: ModelMetadata & {
    responseModel: string;
  };
  usage: AssistantMessage["usage"];
}

function lastAssistantMessage(
  messages: readonly unknown[],
): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant"
    ) {
      return message as AssistantMessage;
    }
  }
  return undefined;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter(
      (block): block is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Runs benchmark-owned answer synthesis after PiMem has finished retrieval. */
export async function runBenchmarkAnswer(options: {
  modelRuntime: PiModelRuntime;
  prompt: BenchmarkAnswerPrompt;
  maxRunMs?: number;
}): Promise<BenchmarkAnswerResult> {
  const maxRunMs = options.maxRunMs ?? 120_000;
  const agent = new Agent({
    initialState: {
      systemPrompt: options.prompt.systemPrompt,
      model: options.modelRuntime.model,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      tools: [],
    },
    streamFn: options.modelRuntime.streamFn,
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
  const answer = assistantText(message);
  if (!answer) throw new Error("Benchmark answer stage returned empty text");
  const responseModel = assertRequestedResponseModel(
    options.modelRuntime.modelId,
    message.responseModel,
    "Benchmark answer",
  );
  return {
    answer,
    promptAdapter: options.prompt.adapterId,
    promptVersion: options.prompt.promptVersion,
    promptHash: sha256(
      `${options.prompt.systemPrompt}\0${options.prompt.userPrompt}`,
    ),
    model: {
      providerId: options.modelRuntime.providerId,
      modelId: options.modelRuntime.modelId,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      responseModel,
    },
    usage: message.usage,
  };
}
