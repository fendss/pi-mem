import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  orderCandidatesForEvidenceAttention,
  PIMEM_HARNESS_VERSION,
  PI_MEM_SYSTEM_PROMPT,
  PI_MEM_SYSTEM_PROMPT_V6,
  PI_MEM_V6_HARNESS_VERSION,
  renderPiMemQuestionPrompt,
} from "../src/runtime.js";
import type { MemoryCandidate } from "../src/types.js";

function candidate(
  memoryId: string,
  state: { read?: boolean; cited?: boolean } = {},
): MemoryCandidate {
  return {
    memoryId,
    scopeId: "scope-1",
    sessionId: "session-1",
    turnIndex: 0,
    role: "user",
    preview: memoryId,
    discoveries: [{ step: 1, tool: "search", query: "source" }],
    read: state.read ?? false,
    cited: state.cited ?? false,
  };
}

describe("runtime candidate presentation", () => {
  it("pins the validated 356-run retrieval harness boundary", () => {
    expect(PIMEM_HARNESS_VERSION).toBe(
      "pimem-retrieval-v5-simple-operator-routing",
    );
    expect(createHash("sha256").update(PI_MEM_SYSTEM_PROMPT).digest("hex"))
      .toBe("b7639320177c563fb0ffad2289a221192fd435d96336278a66b7cfee45cec64f");
  });

  it("pins the opt-in v6 bounded-coverage candidate", () => {
    expect(PI_MEM_V6_HARNESS_VERSION).toBe(
      "pimem-retrieval-v6-query-fair-verification",
    );
    expect(createHash("sha256").update(PI_MEM_SYSTEM_PROMPT_V6).digest("hex"))
      .toBe("a28a587aa6967fcd335917e336280ebabce6dc38d48038f4b3f1c754b2b7ab30");
  });

  it("uses a neutral bounded-coverage question protocol only for v6", () => {
    const v5 = renderPiMemQuestionPrompt("List all events", undefined, "v5");
    const v6 = renderPiMemQuestionPrompt("List all events", undefined, "v6");

    expect(v5).toContain("Question-shaped retrieval attention");
    expect(v6).not.toContain("Question-shaped retrieval attention");
    expect(v6).toContain("do not finish after the first search");
    expect(v6).toContain("bounded to three search rounds total");
  });

  it("presents cited and read evidence first without dropping or mutating candidates", () => {
    const input = [
      candidate("unread-a"),
      candidate("read-a", { read: true }),
      candidate("cited-a", { read: true, cited: true }),
      candidate("read-b", { read: true }),
      candidate("unread-b"),
      candidate("cited-b", { read: true, cited: true }),
    ];

    expect(orderCandidatesForEvidenceAttention(input).map((item) => item.memoryId))
      .toEqual(["cited-a", "cited-b", "read-a", "read-b", "unread-a", "unread-b"]);
    expect(input.map((item) => item.memoryId)).toEqual([
      "unread-a",
      "read-a",
      "cited-a",
      "read-b",
      "unread-b",
      "cited-b",
    ]);
  });
});
