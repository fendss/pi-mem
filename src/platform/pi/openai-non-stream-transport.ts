import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import { convertMessages } from "@earendil-works/pi-ai/api/openai-completions";

type JsonObject = Record<string, unknown>;
type MessageCompat = Parameters<typeof convertMessages>[2];

interface ChatCompletionToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface ChatCompletionChoice {
  finish_reason?: unknown;
  message?: {
    content?: unknown;
    reasoning_content?: unknown;
    reasoning?: unknown;
    reasoning_text?: unknown;
    tool_calls?: unknown;
  };
}

interface ChatCompletionResponse {
  id?: unknown;
  model?: unknown;
  choices?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: {
      cached_tokens?: unknown;
      cache_write_tokens?: unknown;
    };
    prompt_cache_hit_tokens?: unknown;
    completion_tokens_details?: {
      reasoning_tokens?: unknown;
    };
  };
}

function resolvedMessageCompat(
  model: Model<"openai-completions">,
): MessageCompat {
  const configured = model.compat;
  return {
    supportsStore: configured?.supportsStore ?? true,
    supportsDeveloperRole: configured?.supportsDeveloperRole ?? true,
    supportsReasoningEffort: configured?.supportsReasoningEffort ?? true,
    supportsUsageInStreaming: configured?.supportsUsageInStreaming ?? true,
    maxTokensField: configured?.maxTokensField ?? "max_completion_tokens",
    requiresToolResultName: configured?.requiresToolResultName ?? false,
    requiresAssistantAfterToolResult:
      configured?.requiresAssistantAfterToolResult ?? false,
    requiresThinkingAsText: configured?.requiresThinkingAsText ?? false,
    requiresReasoningContentOnAssistantMessages:
      configured?.requiresReasoningContentOnAssistantMessages ?? false,
    thinkingFormat: configured?.thinkingFormat ?? "openai",
    openRouterRouting: configured?.openRouterRouting ?? {},
    vercelGatewayRouting: configured?.vercelGatewayRouting ?? {},
    chatTemplateKwargs: configured?.chatTemplateKwargs ?? {},
    zaiToolStream: configured?.zaiToolStream ?? false,
    supportsStrictMode: configured?.supportsStrictMode ?? true,
    supportsOpenAIGrammarTools:
      configured?.supportsOpenAIGrammarTools ?? false,
    cacheControlFormat: configured?.cacheControlFormat,
    sendSessionAffinityHeaders:
      configured?.sendSessionAffinityHeaders ?? false,
    deferredToolsMode: configured?.deferredToolsMode,
    sessionAffinityFormat: configured?.sessionAffinityFormat ?? "openai",
    supportsLongCacheRetention:
      configured?.supportsLongCacheRetention ?? true,
  };
}

function requestHeaders(
  model: Model<"openai-completions">,
  options: SimpleStreamOptions | undefined,
): Headers {
  const apiKey = options?.apiKey?.trim();
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  });
  for (const source of [model.headers, options?.headers]) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
  }
  return headers;
}

function serializedTools(
  context: Context,
  compat: MessageCompat,
): JsonObject[] | undefined {
  if (!context.tools || context.tools.length === 0) return undefined;
  return context.tools.map((tool) => {
    if (tool.constrainedSampling) {
      throw new Error(
        `Non-stream transport does not support constrained tool ${tool.name}`,
      );
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(compat.supportsStrictMode ? { strict: false } : {}),
      },
    };
  });
}

function buildPayload(
  model: Model<"openai-completions">,
  context: Context,
  options: SimpleStreamOptions | undefined,
): JsonObject {
  const compat = resolvedMessageCompat(model);
  const payload: JsonObject = {
    model: model.id,
    messages: convertMessages(model, context, compat),
    stream: false,
  };
  const maxTokens = options?.maxTokens ?? model.maxTokens;
  payload[compat.maxTokensField] = maxTokens;
  if (options?.temperature !== undefined) {
    payload.temperature = options.temperature;
  }
  if (
    model.reasoning &&
    options?.reasoning !== undefined &&
    compat.supportsReasoningEffort
  ) {
    payload.reasoning_effort = options.reasoning;
  }
  const tools = serializedTools(context, compat);
  if (tools) payload.tools = tools;
  if (compat.supportsStore) payload.store = false;
  return payload;
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function responseUsage(
  model: Model<"openai-completions">,
  raw: ChatCompletionResponse["usage"],
): Usage {
  const promptTokens = nonNegativeInteger(raw?.prompt_tokens);
  const cacheRead = nonNegativeInteger(
    raw?.prompt_tokens_details?.cached_tokens ?? raw?.prompt_cache_hit_tokens,
  );
  const cacheWrite = nonNegativeInteger(
    raw?.prompt_tokens_details?.cache_write_tokens,
  );
  const output = nonNegativeInteger(raw?.completion_tokens);
  const usage: Usage = {
    input: Math.max(0, promptTokens - cacheRead - cacheWrite),
    output,
    cacheRead,
    cacheWrite,
    reasoning: nonNegativeInteger(
      raw?.completion_tokens_details?.reasoning_tokens,
    ),
    totalTokens: promptTokens + output,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  calculateCost(model, usage);
  return usage;
}

function responseText(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part !== "object" || part === null || Array.isArray(part)) {
          return "";
        }
        const value = part as JsonObject;
        return value.type === "text" && typeof value.text === "string"
          ? value.text
          : "";
      })
      .join("");
  }
  throw new Error("Chat completion message content is invalid");
}

function responseThinking(message: NonNullable<ChatCompletionChoice["message"]>):
  | { thinking: string; signature: string }
  | undefined {
  for (const field of [
    "reasoning_content",
    "reasoning",
    "reasoning_text",
  ] as const) {
    const value = message[field];
    if (typeof value === "string" && value.length > 0) {
      return { thinking: value, signature: field };
    }
  }
  return undefined;
}

function responseToolCalls(value: unknown): ToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Chat completion tool_calls must be an array");
  }
  return value.map((raw, index) => {
    const call = asObject(raw, `tool_calls[${index}]`) as ChatCompletionToolCall;
    if (call.type !== undefined && call.type !== "function") {
      throw new Error(`Unsupported chat completion tool type: ${String(call.type)}`);
    }
    const id = call.id;
    const name = call.function?.name;
    const serializedArguments = call.function?.arguments;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
      throw new Error(`tool_calls[${index}] is missing an id or function name`);
    }
    let parsedArguments: unknown;
    if (typeof serializedArguments === "string") {
      try {
        parsedArguments = serializedArguments.trim()
          ? JSON.parse(serializedArguments)
          : {};
      } catch {
        throw new Error(`tool_calls[${index}] contains invalid JSON arguments`);
      }
    } else {
      parsedArguments = serializedArguments ?? {};
    }
    return {
      type: "toolCall",
      id,
      name,
      arguments: asObject(
        parsedArguments,
        `tool_calls[${index}].function.arguments`,
      ),
    };
  });
}

function finishReason(
  value: unknown,
  hasToolCalls: boolean,
): { stopReason: StopReason; errorMessage?: string } {
  if (value === "tool_calls" || value === "function_call" || hasToolCalls) {
    return { stopReason: "toolUse" };
  }
  if (value === "stop" || value === "end") return { stopReason: "stop" };
  if (value === "length") return { stopReason: "length" };
  if (value === "content_filter") {
    return {
      stopReason: "error",
      errorMessage: "Provider finish_reason: content_filter",
    };
  }
  return {
    stopReason: "error",
    errorMessage: `Provider returned invalid finish_reason: ${String(value)}`,
  };
}

function errorMessageFromBody(text: string): string {
  try {
    const parsed = asObject(JSON.parse(text), "provider error response");
    const error = parsed.error;
    if (typeof error === "object" && error !== null && !Array.isArray(error)) {
      const message = (error as JsonObject).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  } catch {
    // Fall back to the bounded response text below.
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 2_000) : "empty response body";
}

function emitCompletedMessage(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  message: AssistantMessage,
): void {
  stream.push({ type: "start", partial: message });
  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index]!;
    if (block.type === "text") {
      stream.push({ type: "text_start", contentIndex: index, partial: message });
      if (block.text) {
        stream.push({
          type: "text_delta",
          contentIndex: index,
          delta: block.text,
          partial: message,
        });
      }
      stream.push({
        type: "text_end",
        contentIndex: index,
        content: block.text,
        partial: message,
      });
      continue;
    }
    if (block.type === "thinking") {
      stream.push({
        type: "thinking_start",
        contentIndex: index,
        partial: message,
      });
      if (block.thinking) {
        stream.push({
          type: "thinking_delta",
          contentIndex: index,
          delta: block.thinking,
          partial: message,
        });
      }
      stream.push({
        type: "thinking_end",
        contentIndex: index,
        content: block.thinking,
        partial: message,
      });
      continue;
    }
    const serializedArguments = JSON.stringify(block.arguments);
    stream.push({
      type: "toolcall_start",
      contentIndex: index,
      partial: message,
    });
    stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: serializedArguments,
      partial: message,
    });
    stream.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall: block,
      partial: message,
    });
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    stream.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    stream.push({ type: "done", reason: message.stopReason, message });
  }
}

export const openAINonStreamingStreamFn: StreamFn = (
  genericModel,
  context,
  options,
) => {
  const stream = createAssistantMessageEventStream();
  const model = genericModel as Model<"openai-completions">;
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: responseUsage(model, undefined),
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      if (model.api !== "openai-completions") {
        throw new Error("Non-stream transport requires openai-completions");
      }
      let payload: unknown = buildPayload(model, context, options);
      const transformed = await options?.onPayload?.(payload, model);
      if (transformed !== undefined) payload = transformed;
      const finalPayload = asObject(payload, "OpenAI request payload");
      finalPayload.stream = false;
      delete finalPayload.stream_options;

      const response = await fetch(
        `${model.baseUrl.replace(/\/+$/u, "")}/chat/completions`,
        {
          method: "POST",
          headers: requestHeaders(model, options),
          body: JSON.stringify(finalPayload),
          ...(options?.signal === undefined
            ? {}
            : { signal: options.signal }),
        },
      );
      await options?.onResponse?.(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        },
        model,
      );
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${errorMessageFromBody(bodyText)}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        throw new Error("Provider returned invalid JSON");
      }
      const completion = asObject(
        parsed,
        "chat completion response",
      ) as ChatCompletionResponse;
      if (!Array.isArray(completion.choices) || completion.choices.length === 0) {
        throw new Error("Chat completion response contains no choices");
      }
      const choice = asObject(
        completion.choices[0],
        "chat completion choice",
      ) as ChatCompletionChoice;
      if (!choice.message) {
        throw new Error("Chat completion choice contains no message");
      }
      const text = responseText(choice.message.content);
      const thinking = responseThinking(choice.message);
      const toolCalls = responseToolCalls(choice.message.tool_calls);
      message.content = [
        ...(thinking
          ? [{
              type: "thinking" as const,
              thinking: thinking.thinking,
              thinkingSignature: thinking.signature,
            }]
          : []),
        ...(text ? [{ type: "text" as const, text }] : []),
        ...toolCalls,
      ];
      const mapped = finishReason(choice.finish_reason, toolCalls.length > 0);
      message.stopReason = mapped.stopReason;
      if (mapped.errorMessage !== undefined) {
        message.errorMessage = mapped.errorMessage;
      }
      if (typeof completion.id === "string") {
        message.responseId = completion.id;
      }
      if (typeof completion.model === "string" && completion.model) {
        message.responseModel = completion.model;
      }
      message.usage = responseUsage(model, completion.usage);
      emitCompletedMessage(stream, message);
    } catch (error) {
      message.stopReason = options?.signal?.aborted ? "aborted" : "error";
      message.errorMessage = options?.signal?.aborted
        ? "Request was aborted"
        : error instanceof Error
          ? error.message
          : String(error);
      stream.push({
        type: "error",
        reason: message.stopReason,
        error: message,
      });
    }
  })();

  return stream;
};
