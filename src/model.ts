import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Model,
  OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {
  StreamFn,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";

type JsonObject = Record<string, unknown>;

export interface LoadPiModelRuntimeOptions {
  agentDir?: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface PiModelRuntime {
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  model: Model<"openai-completions">;
  streamFn: StreamFn;
  getApiKey: (providerId: string) => Promise<string | undefined>;
}

export interface CreatePiModelRuntimeOptions {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKeyEnv: string;
  thinkingLevel?: ThinkingLevel;
  contextWindow?: number;
  maxTokens?: number;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
}

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function returnedModelMatches(
  requested: string,
  returned: string,
): boolean {
  return returned === requested || returned.startsWith(`${requested}-`);
}

/**
 * Verifies provider-returned model metadata rather than trusting the requested
 * model copied into the local AssistantMessage. OpenAI-compatible streaming
 * responses include the actual model on every successful assistant turn.
 */
export function assertRequestedResponseModel(
  requested: string,
  returned: string | undefined,
  stage: string,
): string {
  const actual = returned?.trim();
  if (!actual) {
    throw new Error(
      `${stage} provider omitted response model metadata; expected ${requested}`,
    );
  }
  if (!returnedModelMatches(requested, actual)) {
    throw new Error(
      `${stage} provider substituted model ${actual}; expected ${requested}`,
    );
  }
  return actual;
}

function optionalBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function optionalCost(value: unknown, label: string): typeof DEFAULT_COST {
  if (value === undefined) return { ...DEFAULT_COST };
  const cost = asObject(value, label);
  const result = { ...DEFAULT_COST };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const rate = cost[key];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
      throw new Error(`${label}.${key} must be a non-negative number`);
    }
    result[key] = rate;
  }
  return result;
}

function optionalInput(value: unknown, label: string): ("text" | "image")[] {
  if (value === undefined) return ["text"];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => item !== "text" && item !== "image")
  ) {
    throw new Error(`${label} must contain only text or image`);
  }
  return [...new Set(value)] as ("text" | "image")[];
}

function optionalCompat(
  providerValue: unknown,
  modelValue: unknown,
): OpenAICompletionsCompat | undefined {
  const providerCompat =
    providerValue === undefined
      ? undefined
      : asObject(providerValue, "provider.compat");
  const modelCompat =
    modelValue === undefined ? undefined : asObject(modelValue, "model.compat");
  const raw = { ...providerCompat, ...modelCompat };
  if (Object.keys(raw).length === 0) return undefined;

  const maxTokensField = raw.maxTokensField;
  if (
    maxTokensField !== undefined &&
    maxTokensField !== "max_tokens" &&
    maxTokensField !== "max_completion_tokens"
  ) {
    throw new Error("compat.maxTokensField is invalid");
  }

  return {
    ...(maxTokensField === undefined ? {} : { maxTokensField }),
  };
}

function validateBaseUrl(value: unknown): string {
  const baseUrl = asNonEmptyString(value, "provider.baseUrl");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("provider.baseUrl must be a valid URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "provider.baseUrl must use http or https and must not contain credentials",
    );
  }
  return baseUrl.replace(/\/+$/u, "");
}

async function parseJsonFile(path: string, label: string): Promise<JsonObject> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
  try {
    return asObject(JSON.parse(text) as unknown, label);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message !== `${label} must be an object`
    ) {
      throw new Error(`Unable to parse ${label}`);
    }
    throw error;
  }
}

function trustedCommand(apiKeyConfig: unknown): string {
  const configured = asNonEmptyString(
    apiKeyConfig,
    "provider.apiKey",
  );
  if (!configured.startsWith("!")) {
    throw new Error(
      "provider.apiKey must be a trusted !command from models.json",
    );
  }
  const command = configured.slice(1).trim();
  if (!command || command.includes("\0")) {
    throw new Error("provider.apiKey contains an invalid trusted command");
  }
  return command;
}

async function executeTrustedApiKeyCommand(command: string): Promise<string> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "/bin/sh",
      ["-lc", command],
      {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, output) => {
        if (error) {
          reject(new Error("Configured API key command failed"));
          return;
        }
        resolve(output);
      },
    );
  });
  const apiKey = stdout.trim();
  if (!apiKey || apiKey.includes("\n") || apiKey.includes("\r")) {
    throw new Error("Configured API key command returned an invalid value");
  }
  return apiKey;
}

export function createPiModelRuntime(
  options: CreatePiModelRuntimeOptions,
): PiModelRuntime {
  const providerId = asNonEmptyString(options.providerId, "providerId");
  const modelId = asNonEmptyString(options.modelId, "modelId");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(options.apiKeyEnv)) {
    throw new Error("apiKeyEnv must be an environment variable name");
  }
  const thinkingLevel = options.thinkingLevel ?? "off";
  if (!THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel is invalid");
  }
  const model: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: providerId,
    baseUrl: validateBaseUrl(options.baseUrl),
    reasoning: false,
    input: ["text"],
    cost: { ...DEFAULT_COST },
    contextWindow: optionalPositiveInteger(
      options.contextWindow,
      128_000,
      "contextWindow",
    ),
    maxTokens: optionalPositiveInteger(options.maxTokens, 16_384, "maxTokens"),
    compat: { maxTokensField: options.maxTokensField ?? "max_tokens" },
  };
  const api = openAICompletionsApi();
  const getApiKey = async (
    requestedProviderId: string,
  ): Promise<string | undefined> => {
    if (requestedProviderId !== providerId) return undefined;
    const apiKey = process.env[options.apiKeyEnv]?.trim();
    if (!apiKey || apiKey.includes("\n") || apiKey.includes("\r")) {
      throw new Error("Configured API key environment variable is invalid");
    }
    return apiKey;
  };
  return {
    providerId,
    modelId,
    thinkingLevel,
    model,
    streamFn: api.streamSimple,
    getApiKey,
  };
}

export async function loadPiModelRuntime(
  options: LoadPiModelRuntimeOptions = {},
): Promise<PiModelRuntime> {
  const agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
  const [settings, modelsConfig] = await Promise.all([
    parseJsonFile(join(agentDir, "settings.json"), "settings.json"),
    parseJsonFile(join(agentDir, "models.json"), "models.json"),
  ]);

  const providerId = asNonEmptyString(
    options.providerId ?? settings.defaultProvider,
    options.providerId === undefined
      ? "settings.defaultProvider"
      : "provider override",
  );
  const modelId = asNonEmptyString(
    options.modelId ?? settings.defaultModel,
    options.modelId === undefined ? "settings.defaultModel" : "model override",
  );
  const rawThinkingLevel =
    options.thinkingLevel ?? settings.defaultThinkingLevel ?? "off";
  if (
    typeof rawThinkingLevel !== "string" ||
    !THINKING_LEVELS.has(rawThinkingLevel as ThinkingLevel)
  ) {
    throw new Error("settings.defaultThinkingLevel is invalid");
  }
  const thinkingLevel = rawThinkingLevel as ThinkingLevel;

  const providers = asObject(modelsConfig.providers, "models.json.providers");
  const provider = asObject(
    providers[providerId],
    `models.json.providers.${providerId}`,
  );
  const providerApi = asNonEmptyString(provider.api, "provider.api");
  if (providerApi !== "openai-completions") {
    throw new Error(
      "Only the openai-completions API is supported by this minimal runtime",
    );
  }
  if (!Array.isArray(provider.models)) {
    throw new Error("provider.models must be an array");
  }
  const rawModel = provider.models.find((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    return (value as JsonObject).id === modelId;
  });
  if (!rawModel) {
    throw new Error(`Default model is not configured for provider ${providerId}`);
  }
  const modelConfig = asObject(rawModel, `model ${modelId}`);
  const modelApi =
    modelConfig.api === undefined
      ? providerApi
      : asNonEmptyString(modelConfig.api, "model.api");
  if (modelApi !== "openai-completions") {
    throw new Error(
      "Only the openai-completions API is supported by this minimal runtime",
    );
  }

  const command = options.apiKeyEnv === undefined
    ? trustedCommand(provider.apiKey)
    : undefined;
  if (
    options.apiKeyEnv !== undefined &&
    !/^[A-Z_][A-Z0-9_]*$/u.test(options.apiKeyEnv)
  ) {
    throw new Error("apiKeyEnv must be an environment variable name");
  }
  const compat = optionalCompat(provider.compat, modelConfig.compat);
  const model: Model<"openai-completions"> = {
    id: modelId,
    name:
      modelConfig.name === undefined
        ? modelId
        : asNonEmptyString(modelConfig.name, "model.name"),
    api: "openai-completions",
    provider: providerId,
    baseUrl: validateBaseUrl(
      options.baseUrl ?? modelConfig.baseUrl ?? provider.baseUrl,
    ),
    reasoning: optionalBoolean(
      modelConfig.reasoning,
      false,
      "model.reasoning",
    ),
    input: optionalInput(modelConfig.input, "model.input"),
    cost: optionalCost(modelConfig.cost, "model.cost"),
    contextWindow: optionalPositiveInteger(
      modelConfig.contextWindow,
      128_000,
      "model.contextWindow",
    ),
    maxTokens: optionalPositiveInteger(
      modelConfig.maxTokens,
      16_384,
      "model.maxTokens",
    ),
    ...(compat === undefined ? {} : { compat }),
  };

  const api = openAICompletionsApi();
  const streamFn: StreamFn = api.streamSimple;
  let apiKeyPromise: Promise<string> | undefined;
  const getApiKey = async (
    requestedProviderId: string,
  ): Promise<string | undefined> => {
    if (requestedProviderId !== providerId) return undefined;
    if (options.apiKeyEnv !== undefined) {
      const apiKey = process.env[options.apiKeyEnv]?.trim();
      if (!apiKey || apiKey.includes("\n") || apiKey.includes("\r")) {
        throw new Error("Configured API key environment variable is invalid");
      }
      return apiKey;
    }
    apiKeyPromise ??= executeTrustedApiKeyCommand(command!);
    return apiKeyPromise;
  };

  return {
    providerId,
    modelId,
    thinkingLevel,
    model,
    streamFn,
    getApiKey,
  };
}
