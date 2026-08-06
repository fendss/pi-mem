import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPiModelRuntime } from "../src/model.js";

const temporaryDirectories: string[] = [];

async function createAgentDir(input?: {
  apiKey?: string;
  api?: string;
  defaultProvider?: string;
  defaultModel?: string;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-model-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });

  const providerId = input?.defaultProvider ?? "test-provider";
  const modelId = input?.defaultModel ?? "test-model";
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: providerId,
      defaultModel: modelId,
      defaultThinkingLevel: "off",
    }),
    "utf8",
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        [providerId]: {
          baseUrl: "http://127.0.0.1:9999/v1/",
          api: input?.api ?? "openai-completions",
          apiKey: input?.apiKey ?? "!printf 'unit-test-key'",
          compat: {
            maxTokensField: "max_tokens",
          },
          models: [
            {
              id: modelId,
              name: "Test Model",
              input: ["text"],
              contextWindow: 32_000,
              maxTokens: 4_096,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
            {
              id: "override-model",
              name: "Override Model",
              input: ["text"],
              contextWindow: 64_000,
              maxTokens: 8_192,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          ],
        },
      },
    }),
    "utf8",
  );
  return agentDir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("loadPiModelRuntime", () => {
  it("loads only the configured default model and resolves its trusted command", async () => {
    const agentDir = await createAgentDir();
    const runtime = await loadPiModelRuntime({ agentDir });

    expect(runtime.providerId).toBe("test-provider");
    expect(runtime.modelId).toBe("test-model");
    expect(runtime.thinkingLevel).toBe("off");
    expect(runtime.transport).toBe("sse");
    expect(runtime.model).toMatchObject({
      id: "test-model",
      name: "Test Model",
      provider: "test-provider",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:9999/v1",
      contextWindow: 32_000,
      maxTokens: 4_096,
      compat: { maxTokensField: "max_tokens" },
    });
    expect(typeof runtime.streamFn).toBe("function");
    expect(await runtime.getApiKey("another-provider")).toBeUndefined();
    expect(await runtime.getApiKey("test-provider")).toBe("unit-test-key");
  });

  it("selects the non-stream transport explicitly", async () => {
    const agentDir = await createAgentDir();
    const runtime = await loadPiModelRuntime({
      agentDir,
      transport: "non-stream",
    });

    expect(runtime.transport).toBe("non-stream");
    expect(typeof runtime.streamFn).toBe("function");
  });

  it("selects an explicit configured model without changing settings", async () => {
    const agentDir = await createAgentDir();
    const runtime = await loadPiModelRuntime({
      agentDir,
      modelId: "override-model",
      thinkingLevel: "minimal",
    });

    expect(runtime.modelId).toBe("override-model");
    expect(runtime.thinkingLevel).toBe("minimal");
    expect(runtime.model).toMatchObject({
      id: "override-model",
      contextWindow: 64_000,
      maxTokens: 8_192,
    });
  });

  it("supports explicit env-name and base-url overrides without persisting a key", async () => {
    const agentDir = await createAgentDir();
    const previous = process.env["PIMEM_TEST_API_KEY"];
    process.env["PIMEM_TEST_API_KEY"] = "runtime-only-key";
    try {
      const runtime = await loadPiModelRuntime({
        agentDir,
        baseUrl: "https://provider.example/v1/",
        apiKeyEnv: "PIMEM_TEST_API_KEY",
      });
      expect(runtime.model.baseUrl).toBe("https://provider.example/v1");
      expect(await runtime.getApiKey("test-provider")).toBe("runtime-only-key");
    } finally {
      if (previous === undefined) delete process.env["PIMEM_TEST_API_KEY"];
      else process.env["PIMEM_TEST_API_KEY"] = previous;
    }
  });

  it("rejects literal and environment API-key forms", async () => {
    const literalDir = await createAgentDir({
      apiKey: "literal-secret-value",
    });
    await expect(
      loadPiModelRuntime({ agentDir: literalDir }),
    ).rejects.toThrow("trusted !command");

    const environmentDir = await createAgentDir({
      apiKey: "$INJECTED_API_KEY",
    });
    await expect(
      loadPiModelRuntime({ agentDir: environmentDir }),
    ).rejects.toThrow("trusted !command");
  });

  it("does not disclose a failed command or its secret output", async () => {
    const agentDir = await createAgentDir({
      apiKey: "!printf 'do-not-disclose' >&2; exit 7",
    });
    const runtime = await loadPiModelRuntime({ agentDir });

    let message = "";
    try {
      await runtime.getApiKey("test-provider");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Configured API key command failed");
    expect(message).not.toContain("do-not-disclose");
    expect(message).not.toContain("printf");
  });

  it("rejects unsupported provider APIs before any model call", async () => {
    const agentDir = await createAgentDir({
      api: "anthropic-messages",
    });
    await expect(
      loadPiModelRuntime({ agentDir }),
    ).rejects.toThrow("Only the openai-completions API is supported");
  });
});
