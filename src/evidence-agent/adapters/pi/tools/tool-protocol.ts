import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";

export function validateFinishToolBatch(
  toolNames: readonly string[],
  finishToolName = "finish",
): string | undefined {
  if (!toolNames.includes(finishToolName)) return undefined;
  if (toolNames.length === 1 && toolNames[0] === finishToolName) {
    return undefined;
  }
  return `${finishToolName} must be the only tool call in its turn`;
}

export function createFinishOnlyBeforeToolCall(
  finishToolName = "finish",
): (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined> {
  return async (context) => {
    const toolNames = context.assistantMessage.content
      .filter(
        (
          block,
        ): block is Extract<
          AssistantMessage["content"][number],
          { type: "toolCall" }
        > => block.type === "toolCall",
      )
      .map((call) => call.name);
    const finishIndexes = toolNames
      .map((name, index) => name === finishToolName ? index : -1)
      .filter((index) => index >= 0);
    if (finishIndexes.length === 0) return undefined;
    if (
      finishIndexes.length === 1 &&
      finishIndexes[0] === toolNames.length - 1
    ) {
      return undefined;
    }
    if (context.toolCall.name !== finishToolName) return undefined;
    return {
      block: true,
      reason: `${finishToolName} must be the final tool call in its turn`,
    };
  };
}

export function createToolProtocolBeforeToolCall(options: {
  maxSearchCalls?: number;
} = {}): (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined> {
  const enforceFinishOnly = createFinishOnlyBeforeToolCall();
  let admittedSearchCalls = 0;
  return async (context, signal) => {
    const finishResult = await enforceFinishOnly(context, signal);
    if (finishResult !== undefined) return finishResult;
    if (
      context.toolCall.name !== "search" ||
      options.maxSearchCalls === undefined
    ) {
      return undefined;
    }
    if (admittedSearchCalls >= options.maxSearchCalls) {
      return {
        block: true,
        reason: `Search budget exhausted after ${options.maxSearchCalls} calls. Use existing candidates, read the needed sources, and call finish.`,
      };
    }
    admittedSearchCalls += 1;
    return undefined;
  };
}
