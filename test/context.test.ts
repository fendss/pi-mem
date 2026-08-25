import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createEphemeralMemoryContext } from "../src/evidence-agent/index.js";

function toolResult(
  toolCallId: string,
  toolName: string,
  text: string,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  };
}

describe("ephemeral memory context", () => {
  it("shows the current navigation batch once and expires older search output", async () => {
    const context = createEphemeralMemoryContext();
    const oldSearch = toolResult("search-1", "search", "large noisy preview");
    const selectedRead = toolResult("read-1", "read", "selected exact evidence");
    const currentSearch = toolResult("search-2", "search", "current preview");
    const messages = [
      oldSearch,
      {
        role: "user",
        content: "continue",
        timestamp: 2,
      } satisfies AgentMessage,
      selectedRead,
      currentSearch,
    ];

    const transformed = await context.transformContext(messages);

    expect(transformed[0]).not.toBe(oldSearch);
    expect(JSON.stringify(transformed[0])).toMatch(/expired from active/u);
    expect(transformed[2]).toBe(selectedRead);
    expect(transformed[3]).toBe(currentSearch);
    expect(JSON.stringify(oldSearch)).toContain("large noisy preview");
    expect(context.snapshot()).toEqual({
      expiredNavigationResults: 1,
      compactedReadResults: 0,
    });
  });

  it("expires bash and operator-definition navigation but preserves errors", async () => {
    const context = createEphemeralMemoryContext();
    const bash = toolResult("bash-1", "bash_ro", "many grep rows");
    const definition = toolResult(
      "define-1",
      "define_operator",
      "defined dual-recall",
    );
    const error = {
      ...toolResult("search-error", "search", "failure"),
      isError: true,
    };
    const messages = [
      bash,
      definition,
      error,
      { role: "user", content: "continue", timestamp: 2 } satisfies AgentMessage,
    ];

    const transformed = await context.transformContext(messages);

    expect(JSON.stringify(transformed[0])).toMatch(/expired from active/u);
    expect(JSON.stringify(transformed[1])).toMatch(/expired from active/u);
    expect(transformed[2]).toBe(error);
    expect(context.snapshot()).toEqual({
      expiredNavigationResults: 2,
      compactedReadResults: 0,
    });
  });

  it("keeps read evidence for one reasoning turn then compacts its text", async () => {
    const context = createEphemeralMemoryContext();
    const oldRead = toolResult("read-1", "read", "bounded exact evidence");
    const messages = [
      oldRead,
      { role: "user", content: "continue", timestamp: 2 } satisfies AgentMessage,
    ];

    const transformed = await context.transformContext(messages);

    expect(JSON.stringify(transformed[0])).toMatch(/compacted after one reasoning turn/u);
    expect(JSON.stringify(transformed[0])).not.toContain("bounded exact evidence");
    expect(context.snapshot()).toEqual({
      expiredNavigationResults: 0,
      compactedReadResults: 1,
    });
  });
});
