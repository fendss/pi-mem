import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  Type,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { openAINonStreamingStreamFn } from "../src/platform/pi/openai-non-stream-transport.js";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}/v1`;
}

async function close(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

describe("OpenAI non-stream transport", () => {
  it("maps complete tool calls and usage onto the Pi event protocol", async () => {
    let requestPayload: Record<string, unknown> | undefined;
    let authorization: string | undefined;
    const server = createServer(async (request, response) => {
      authorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requestPayload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "chatcmpl-test",
        model: "gpt-4o-mini-2024-07-18",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "Checking memory.",
              tool_calls: [
                {
                  id: "call-search",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: JSON.stringify({ queries: ["blue notebook"] }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }));
    });
    const baseUrl = await listen(server);
    try {
      const model: Model<"openai-completions"> = {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        api: "openai-completions",
        provider: "test-provider",
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
        contextWindow: 128_000,
        maxTokens: 16_384,
        compat: { maxTokensField: "max_tokens" },
      };
      const context: Context = {
        systemPrompt: "Use tools.",
        messages: [
          {
            role: "user",
            content: "Find the notebook.",
            timestamp: 1,
          },
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call-old",
                name: "search",
                arguments: { queries: ["notebook"] },
              },
            ],
            api: "openai-completions",
            provider: "test-provider",
            model: "gpt-4o-mini",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "toolUse",
            timestamp: 2,
          },
          {
            role: "toolResult",
            toolCallId: "call-old",
            toolName: "search",
            content: [{ type: "text", text: "Found one candidate." }],
            isError: false,
            timestamp: 3,
          },
        ],
        tools: [
          {
            name: "search",
            description: "Search memory",
            parameters: Type.Object({
              queries: Type.Array(Type.String()),
            }),
          },
        ],
      };

      const stream = await openAINonStreamingStreamFn(model, context, {
        apiKey: "unit-test-key",
        temperature: 0,
        maxTokens: 321,
      });
      const events = [];
      for await (const event of stream) events.push(event);
      const result = await stream.result();

      expect(authorization).toBe("Bearer unit-test-key");
      expect(requestPayload).toMatchObject({
        model: "gpt-4o-mini",
        stream: false,
        max_tokens: 321,
        temperature: 0,
        store: false,
      });
      expect(requestPayload).not.toHaveProperty("stream_options");
      expect(requestPayload?.messages).toEqual([
        { role: "system", content: "Use tools." },
        { role: "user", content: "Find the notebook." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-old",
              type: "function",
              function: {
                name: "search",
                arguments: JSON.stringify({ queries: ["notebook"] }),
              },
            },
          ],
        },
        {
          role: "tool",
          content: "Found one candidate.",
          tool_call_id: "call-old",
        },
      ]);
      expect(requestPayload?.tools).toEqual([
        {
          type: "function",
          function: {
            name: "search",
            description: "Search memory",
            parameters: Type.Object({
              queries: Type.Array(Type.String()),
            }),
            strict: false,
          },
        },
      ]);
      expect(events.map((event) => event.type)).toEqual([
        "start",
        "text_start",
        "text_delta",
        "text_end",
        "toolcall_start",
        "toolcall_delta",
        "toolcall_end",
        "done",
      ]);
      expect(result).toMatchObject({
        responseId: "chatcmpl-test",
        responseModel: "gpt-4o-mini-2024-07-18",
        stopReason: "toolUse",
        usage: {
          input: 8,
          output: 3,
          cacheRead: 2,
          totalTokens: 13,
        },
        content: [
          { type: "text", text: "Checking memory." },
          {
            type: "toolCall",
            id: "call-search",
            name: "search",
            arguments: { queries: ["blue notebook"] },
          },
        ],
      });
    } finally {
      await close(server);
    }
  });
});
