import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  orderCandidatesForEvidenceAttention,
  PIMEM_HARNESS_VERSION,
  PI_MEM_SYSTEM_PROMPT,
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
