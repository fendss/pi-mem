import { describe, expect, it } from "vitest";
import { MemoryLedger } from "../src/ledger.js";
import type { StoreSearchHit } from "../src/store.js";
import type { MemoryRecord } from "../src/types.js";

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

describe("MemoryLedger", () => {
  it("keeps citations within evidence within candidates", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    const searchOnly = record("m2", 1);
    const expanded = record("m3", 2);

    ledger.recordSearchHits([hit(first, 1), hit(searchOnly, 2)]);
    ledger.recordRead([first, expanded]);
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
    ledger.recordRead([candidate]);
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

  it("rejects duplicate citations and empty cited raw memories", () => {
    const ledger = new MemoryLedger("scope-1");
    const candidate = record("m1", 0);
    ledger.recordRead([candidate]);

    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [
          { memoryId: "m1", supports: "First support." },
          { memoryId: "m1", supports: "Repeated support." },
        ],
        evidenceSummary: "Repeated source.",
      }),
    ).toThrow(/Duplicate citation memory/u);

    const emptyLedger = new MemoryLedger("scope-1");
    emptyLedger.recordRead([{ ...candidate, content: "" }]);
    expect(() =>
      emptyLedger.acceptSelection({
        status: "sufficient",
        citations: [{ memoryId: "m1", supports: "Unsupported text." }],
        evidenceSummary: "Empty source.",
      }),
    ).toThrow(/empty raw content/u);
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
    ledger.recordRead([first, second]);

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

  it("rejects inventory sources that are read but not cited", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    const second = record("m2", 1);
    ledger.recordRead([first, second]);

    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [{ memoryId: "m1", supports: "First item." }],
        evidenceSummary: "Inventory includes an uncited source.",
        inventory: [{ item: "second", memoryIds: ["m2"] }],
      }),
    ).toThrow(/must reference a cited memory/u);
  });

  it("rejects duplicate normalized inventory items", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    ledger.recordRead([first]);

    expect(() =>
      ledger.acceptSelection({
        status: "sufficient",
        citations: [{ memoryId: "m1", supports: "First item." }],
        evidenceSummary: "Duplicate inventory labels.",
        inventory: [
          { item: "First", memoryIds: ["m1"] },
          { item: " first ", memoryIds: ["m1"] },
        ],
      }),
    ).toThrow(/Duplicate inventory item/u);
  });

  it("rejects inventory entries backed only by unread memory", () => {
    const ledger = new MemoryLedger("scope-1");
    const first = record("m1", 0);
    ledger.recordRead([first]);

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
    expect(() => ledger.recordRead([foreign])).toThrow(/expected scope-1/u);
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
