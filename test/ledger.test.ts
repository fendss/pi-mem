import { describe, expect, it } from "vitest";
import { MemoryLedger } from "../src/evidence-agent/index.js";
import {
  MAX_SELECTED_EVIDENCE_CHARS,
  projectMemoryEvidence,
} from "../src/evidence-agent/index.js";
import type { StoreSearchHit } from "../src/platform/sqlite/pimem-store.js";
import type { MemoryRecord } from "../src/memory/index.js";

function record(
  memoryId: string,
  turnIndex: number,
  scopeId = "scope-1",
): MemoryRecord {
  return {
    memoryId,
    scopeId,
    sessionId: "session-1",
    turnIndex,
    role: turnIndex % 2 === 0 ? "user" : "assistant",
    content: `raw content for ${memoryId}`,
    contentHash: `hash-${memoryId}`,
    metadata: {},
  };
}

function hit(memory: MemoryRecord, rank: number): StoreSearchHit {
  return {
    record: memory,
    query: "raw content",
    retriever: "fts5",
    rank,
    score: 10 - rank,
    preview: memory.content,
  };
}

function evidence(records: readonly MemoryRecord[]) {
  return records.map((item) => projectMemoryEvidence(item, [item.content], 4_096));
}

describe("MemoryLedger", () => {
  it("keeps citations within evidence within candidates", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    const searchOnly = record("m2", 1);
    const expanded = record("m3", 2);

    ledger.recordSearchHits([hit(first, 1), hit(searchOnly, 2)]);
    ledger.recordRead(evidence([first, expanded]));
    ledger.acceptSelection({
      status: "sufficient",
      citations: [{ memoryId: expanded.memoryId, supports: "Direct support" }],
      evidenceSummary: "The expanded neighboring turn contains the answer.",
    });

    expect(ledger.candidates.map((candidate) => candidate.memoryId)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    expect(ledger.evidence.map((memory) => memory.memoryId)).toEqual([
      "m1",
      "m3",
    ]);
    expect(ledger.citations.map((citation) => citation.memoryId)).toEqual([
      "m3",
    ]);

    const expandedCandidate = ledger.candidates.find(
      (candidate) => candidate.memoryId === "m3",
    );
    expect(expandedCandidate?.read).toBe(true);
    expect(expandedCandidate?.cited).toBe(true);
    expect(expandedCandidate?.discoveries).toEqual([
      expect.objectContaining({ tool: "read_expansion" }),
    ]);
    expect(
      ledger.candidates.find((candidate) => candidate.memoryId === "m2")?.read,
    ).toBe(false);
    expect(() => ledger.assertInvariants()).not.toThrow();
  });

  it("accepts an identical duplicate finish idempotently", () => {
    const ledger = new MemoryLedger("scope-1");
    const candidate = record("m1", 0);
    ledger.recordSearchHits([hit(candidate, 1)]);
    ledger.recordRead(evidence([candidate]));
    const selection = {
      status: "sufficient" as const,
      citations: [{ memoryId: "m1", supports: "Direct support" }],
      evidenceSummary: "The source provides direct support.",
    };

    expect(ledger.acceptSelection(selection)).toEqual(selection);
    expect(ledger.acceptSelection(selection)).toEqual(selection);
    expect(() => ledger.acceptSelection({
      ...selection,
      evidenceSummary: "A different selection.",
    })).toThrow(/different evidence selection/u);
  });

  it("rejects sufficient selections without citations", () => {
    const ledger = new MemoryLedger("scope-1");
    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [],
        evidenceSummary: "No evidence.",
      }),
    ).toThrow(/at least one memory/u);
  });

  it("rejects citations that were found but not read", () => {
    const ledger = new MemoryLedger("scope-1");
    const candidate = record("m1", 0);
    ledger.recordSearchHits([hit(candidate, 1)]);

    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [{ memoryId: "m1", supports: "Search preview" }],
        evidenceSummary: "Only a preview was seen.",
      }),
    ).toThrow(/read in this run/u);
  });

  it("rejects duplicate citations", () => {
    const ledger = new MemoryLedger("scope-1");
    const candidate = record("m1", 0);
    ledger.recordRead(evidence([candidate]));

    expect(() => ledger.acceptSelection({
      status: "sufficient",
      citations: [
        { memoryId: "m1", supports: "First statement." },
        { memoryId: "m1", supports: "Repeated statement." },
      ],
      evidenceSummary: "Repeated source.",
    })).toThrow(/Duplicate citation/u);
  });

  it("bounds the final cited evidence package", () => {
    const ledger = new MemoryLedger("scope-1");
    const sources = Array.from({ length: 33 }, (_, index) => ({
      ...record(`m-${String(index)}`, index),
      content: "x".repeat(8_192),
    }));
    ledger.recordRead(sources.map((source) =>
      projectMemoryEvidence(source, ["x"], 8_192)
    ));

    expect(() => ledger.acceptSelection({
      status: "sufficient",
      citations: sources.map((source) => ({
        memoryId: source.memoryId,
        supports: "Direct source.",
      })),
      evidenceSummary: "An oversized source set.",
    })).toThrow(new RegExp(String(MAX_SELECTED_EVIDENCE_CHARS), "u"));
  });

  it("allows an insufficient selection with no citations", () => {
    const ledger = new MemoryLedger("scope-1");
    expect(
      ledger.acceptSelection({
        status: "insufficient",
        citations: [],
        evidenceSummary: "No sufficient source memory was found.",
      }),
    ).toEqual({
      status: "insufficient",
      citations: [],
      evidenceSummary: "No sufficient source memory was found.",
    });
  });

  it("preserves a source-backed count inventory in the decision", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    const second = record("m2", 1);
    ledger.recordRead(evidence([first, second]));

    expect(
      ledger.acceptSelection({
        status: "sufficient",
        citations: [
          { memoryId: "m1", supports: "First item." },
          { memoryId: "m2", supports: "Second item." },
        ],
        evidenceSummary: "Two distinct source-backed items.",
        count: 2,
        inventory: [
          { item: "first", memoryIds: ["m1"] },
          { item: "second", memoryIds: ["m2"] },
        ],
      }),
    ).toMatchObject({
      count: 2,
      inventory: [
        { item: "first", memoryIds: ["m1"] },
        { item: "second", memoryIds: ["m2"] },
      ],
    });
  });

  it("rejects inventory entries backed only by unread memory", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    ledger.recordRead(evidence([first]));

    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [{ memoryId: "m1", supports: "First item." }],
        evidenceSummary: "An invalid inventory.",
        count: 2,
        inventory: [
          { item: "first", memoryIds: ["m1"] },
          { item: "second", memoryIds: ["m-unread"] },
        ],
      }),
    ).toThrow(/read in this run/u);
  });

  it("rejects records from another scope", () => {
    const ledger = new MemoryLedger("scope-1");
    const foreign = record("m1", 0, "scope-2");
    expect(() => ledger.recordRead(evidence([foreign]))).toThrow(/expected scope-1/u);
  });

  it("records bash-discovered source IDs as candidates, not evidence", () => {
    const ledger = new MemoryLedger("scope-1");
    const discovered = record("m-bash", 3);
    const candidates = ledger.recordBashDiscoveries(
      [discovered],
      "grep -n needle memory.jsonl",
    );

    expect(candidates[0]).toMatchObject({
      memoryId: "m-bash",
      read: false,
      cited: false,
    });
    expect(candidates[0]?.discoveries[0]).toMatchObject({
      tool: "bash_ro",
      retriever: "bash_ro",
    });
    expect(ledger.evidence).toEqual([]);
  });
});
