import { describe, expect, it } from "vitest";
import {
  PIMEM_SKILL_HASH,
  PIMEM_SKILL_TEXT,
  orderCandidatesForEvidenceAttention,
  piMemSystemPrompt,
} from "../src/evidence-agent/index.js";
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

describe("runtime Skill experiment boundary", () => {
  it("changes only the Skill suffix between none and pimem-v0", () => {
    const baseline = piMemSystemPrompt("none");
    const treatment = piMemSystemPrompt("pimem-v0");

    expect(baseline).not.toContain("<active_skill");
    expect(baseline).not.toContain(PIMEM_SKILL_TEXT);
    expect(treatment.startsWith(`${baseline}\n\n`)).toBe(true);
    expect(treatment).toContain('<active_skill name="pimem-retrieval"');
    expect(treatment).toContain(PIMEM_SKILL_TEXT);
    expect(PIMEM_SKILL_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });
});
