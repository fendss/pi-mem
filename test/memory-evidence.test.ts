import { describe, expect, it } from "vitest";
import {
  MAX_READ_RESULT_CHARS,
  projectMemoryEvidence,
  projectMemoryEvidenceBatch,
} from "../src/evidence-agent/index.js";
import type { MemoryRecord } from "../src/memory/index.js";
import { sha256 } from "../src/util.js";

function record(content: string, memoryId = "m-large"): MemoryRecord {
  return {
    memoryId,
    scopeId: "scope-1",
    sessionId: "session-1",
    turnIndex: 0,
    role: "other",
    content,
    contentHash: sha256(content),
    metadata: {},
  };
}

describe("bounded memory evidence", () => {
  it("keeps small source memories byte-exact", () => {
    const source = record("Step 1:\nAction: inspect\nObservation: blue key");
    const evidence = projectMemoryEvidence(source, ["blue key"], 4_096);

    expect(evidence.content).toBe(source.content);
    expect(evidence.truncated).toBe(false);
    expect(evidence.sourceContentHash).toBe(source.contentHash);
    expect(evidence.excerpts).toEqual([{
      start: 0,
      end: source.content.length,
      content: source.content,
    }]);
  });

  it("finds an exact focused passage inside an oversized source", () => {
    const target = "The World Bank indicator request completed successfully.";
    const content = `Step 5:\nAction: retrieve indicator\n${"x".repeat(300_000)}${target}${"y".repeat(300_000)}`;
    const source = record(content);
    const evidence = projectMemoryEvidence(
      source,
      ["World Bank indicator completed successfully"],
      8_192,
    );

    expect(evidence.truncated).toBe(true);
    expect(evidence.content).toContain(target);
    expect(evidence.content.length).toBeLessThan(9_000);
    expect(evidence.excerpts.reduce((sum, excerpt) => sum + excerpt.content.length, 0))
      .toBeLessThanOrEqual(8_192);
    for (const excerpt of evidence.excerpts) {
      expect(source.content.slice(excerpt.start, excerpt.end)).toBe(excerpt.content);
    }
  });

  it("bounds a large multi-candidate read batch", () => {
    const records = Array.from({ length: 25 }, (_, index) =>
      record(
        `Step ${String(index)}:\n${"noise ".repeat(40_000)}target-${String(index)}`,
        `m-${String(index)}`,
      )
    );
    const evidence = projectMemoryEvidenceBatch(records, (item) => [
      `target-${item.memoryId.slice(2)}`,
    ]);
    const exactChars = evidence.flatMap((item) => item.excerpts)
      .reduce((sum, excerpt) => sum + excerpt.content.length, 0);
    const renderedChars = evidence.reduce((sum, item) => sum + item.content.length, 0);

    expect(exactChars).toBeLessThanOrEqual(MAX_READ_RESULT_CHARS);
    expect(renderedChars).toBeLessThan(72 * 1024);
    expect(evidence.every((item) => item.truncated)).toBe(true);
  });

  it("keeps exact excerpts within the batch budget beyond 256 memories", () => {
    const records = Array.from({ length: 300 }, (_, index) =>
      record(
        `${"head ".repeat(2_000)}target-${String(index)}`,
        `m-wide-${String(index)}`,
      )
    );
    const evidence = projectMemoryEvidenceBatch(records, () => ["target"]);
    const exactChars = evidence.flatMap((item) => item.excerpts)
      .reduce((sum, excerpt) => sum + excerpt.content.length, 0);

    expect(evidence).toHaveLength(records.length);
    expect(exactChars).toBeLessThanOrEqual(MAX_READ_RESULT_CHARS);
    expect(evidence.every((item) => item.truncated)).toBe(true);
    expect(evidence.every((item) => item.content.includes("target-"))).toBe(true);
  });
});
