import { describe, expect, it } from "vitest";
import {
  deterministicRetrievalPayload,
  orderCandidatesForEvidenceAttention,
  PIMEM_HARNESS_VERSION,
  PIMEM_RETRIEVAL_TEMPERATURE,
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
  it("keeps generic source-consistency constraints in the retrieval policy", () => {
    expect(PIMEM_HARNESS_VERSION).toBe("pimem-retrieval-v8-low-churn");
    expect(PI_MEM_SYSTEM_PROMPT).toContain(
      "Distinguish completed observations from plans",
    );
    expect(PI_MEM_SYSTEM_PROMPT).toContain(
      "do not add cumulative snapshots together",
    );
    expect(PI_MEM_SYSTEM_PROMPT).toContain(
      "search again only for a named missing slot",
    );
  });

  it("forces deterministic retrieval sampling without mutating the provider payload", () => {
    const payload = { model: "gpt-4o-mini", stream: true };
    expect(PIMEM_RETRIEVAL_TEMPERATURE).toBe(0);
    expect(deterministicRetrievalPayload(payload)).toEqual({
      model: "gpt-4o-mini",
      stream: true,
      temperature: 0,
    });
    expect(payload).toEqual({ model: "gpt-4o-mini", stream: true });
    expect(() => deterministicRetrievalPayload(null)).toThrow(/must be an object/u);
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
