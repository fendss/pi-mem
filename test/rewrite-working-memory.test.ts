import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { RewriteWorkingMemory } from "../src/evidence-agent/model/rewrite-working-memory.js";
import { createWorkingMemoryContext } from "../src/evidence-agent/adapters/pi/working-memory-context.js";
import { MemoryLedger } from "../src/evidence-agent/model/ledger.js";

const stub: AgentTool = { name: "read", label: "Read", description: "Read",
  parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }) };
const observed: AgentMessage[] = [{ role: "toolResult", toolCallId: "observed", toolName: "search",
  content: [{ type: "text", text: "unprocessed evidence" }], isError: false, timestamp: 1 }];

describe("single-note rewrite", () => {
  it("replaces the current view but preserves detached before/after audit, even when facts are omitted", () => {
    const note = new RewriteWorkingMemory(() => {});
    note.apply("First relation; second relation missing.", "one");
    note.apply("Second relation found.", "two");
    expect(note.render()).not.toContain("First relation");
    const snapshot = note.snapshot();
    expect(snapshot.history[1]).toMatchObject({ before: "First relation; second relation missing.", after: "Second relation found." });
    snapshot.history.length = 0;
    expect(note.snapshot().history).toHaveLength(2);
    note.apply(null, "three");
    note.apply(undefined, "four");
    note.apply("Second relation found.", "five");
    expect(note.snapshot().revision).toBe(2);
  });

  it("rejects invalid replacements atomically without silently truncating the note", () => {
    const note = new RewriteWorkingMemory(text => { if (text.includes("E999")) throw new Error("Unknown source"); });
    note.apply("Keep this fact.", "one");
    const before = note.snapshot();
    for (const value of [" ", "x".repeat(1601), [], "E999 says something."]) {
      expect(() => note.apply(value, "invalid")).toThrow();
      expect(note.snapshot()).toEqual(before);
    }
  });

  it("read and finish omission preserve observations and do not require a note or cleared prose gap", async () => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const [read, finish] = context.wrapTools([stub, { ...stub, name: "finish" }]);
    await context.transformContext(observed);
    await read!.execute("read", {});
    expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
    await finish!.execute("finish", { status: "insufficient" });
    expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
    await read!.execute("note", { workingMemory: "Current fact recorded. Need to check another relation." });
    await finish!.execute("finish2", { status: "sufficient" });
    expect(context.workingMemorySnapshot().revision).toBe(1);
    expect(JSON.stringify(await context.transformContext(observed))).not.toContain("unprocessed evidence");
  });

  it("unknown refs keep the old note and observations; a later native failure retains a valid rewrite", async () => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const read = context.wrapTools([stub])[0]!;
    await read.execute("initial", { workingMemory: "Previous knowledge." });
    await context.transformContext(observed);
    await expect(read.execute("invalid", { workingMemory: "E999 is the source." })).rejects.toThrow("Unknown");
    await expect(read.execute("invalid", { workingMemory: "C999 is the source." })).rejects.toThrow();
    expect(context.workingMemorySnapshot()).toMatchObject({ note: "Previous knowledge.", revision: 1 });
    expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
    const failing = context.wrapTools([{ ...stub, execute: async () => { throw new Error("read unavailable"); } }])[0]!;
    await expect(failing.execute("valid", { workingMemory: "Observed fact; still need its source." })).rejects.toThrow("read unavailable");
    expect(context.workingMemorySnapshot()).toMatchObject({ note: "Observed fact; still need its source.", revision: 2 });
  });

  it("explicit null acknowledges only already-seen results while search still requires an initial note", async () => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const [read, search] = context.wrapTools([stub, { ...stub, name: "search" }]);
    await context.transformContext(observed);
    await expect(search!.execute("search", {})).rejects.toThrow("required");
    await expect(search!.execute("search", { workingMemory: null })).rejects.toThrow("initial");
    await read!.execute("one", { workingMemory: null });
    await read!.execute("two", { workingMemory: null });
    const unseen = { ...observed[0], toolCallId: "unseen", content: [{ type: "text", text: "new unseen evidence" }] } as AgentMessage;
    const next = JSON.stringify(await context.transformContext([...observed, unseen]));
    expect(next).not.toContain("unprocessed evidence");
    expect(next).toContain("new unseen evidence");
  });
});
