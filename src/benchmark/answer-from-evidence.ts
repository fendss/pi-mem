import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { PiModelRuntime } from "../platform/pi/load-model-runtime.js";
import {
  assistantMessageText,
  lastAssistantMessage,
  type ModelMetadata,
} from "../evidence-agent/index.js";
import { assertNonEmpty, newRunId, sha256 } from "../util.js";

export interface BenchmarkAnswerPrompt {
  adapterId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
}

export const BENCHMARK_ANSWER_EXECUTION_CHECKLIST = `<answer_execution>
- Evaluate every requested item or answer option independently against the source memories before composing the final answer.
- For lists and multi-select questions, include every supported item and no unsupported item.
- For ordering questions, reconstruct local event transitions first, then obey the requested forward, backward, nearest-first, or farthest-first direction. Retrieval rank is not chronology.
- Follow the caller's exact output syntax. Emit only the final answer and do not expose memory IDs, ranks, scores, or retrieval metadata.
</answer_execution>`;

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

export function returnedModelMatches(requested: string, returned: string): boolean {
  return returned === requested || returned.startsWith(`${requested}-`);
}

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
