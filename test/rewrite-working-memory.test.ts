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

  it("treats prose refs as annotations and preserves the note and observations on native failure", async () => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const read = context.wrapTools([stub])[0]!;
    await read.execute("initial", { workingMemory: "C999 is discarded; E999 might be a future label." });
    await context.transformContext(observed);
    const failing = context.wrapTools([{ ...stub, execute: async () => { throw new Error("read unavailable"); } }])[0]!;
    await expect(failing.execute("failed", { workingMemory: "New note." })).rejects.toThrow("read unavailable");
    expect(context.workingMemorySnapshot()).toMatchObject({ note: "C999 is discarded; E999 might be a future label.", revision: 1 });
    expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
  });

  it("omission and null mean the same thing on every tool; only a replacement acknowledges prior results", async () => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const tools = context.wrapTools([stub, { ...stub, name: "search" }, { ...stub, name: "finish" }]);
    await context.transformContext(observed);
    for (const tool of tools) {
      const required = (tool.parameters as {required?: string[]}).required ?? [];
      expect(required).not.toContain("workingMemory");
      expect(JSON.stringify(tool.parameters)).not.toContain('"not"');
      await tool.execute(tool.name + "-omitted", {});
      await tool.execute(tool.name + "-null", { workingMemory: null });
      expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
    }
    await tools[0]!.execute("update", { workingMemory: "Current fact; the next relation is missing." });
    const unseen = { ...observed[0], toolCallId: "unseen", content: [{ type: "text", text: "new unseen evidence" }] } as AgentMessage;
    const next = JSON.stringify(await context.transformContext([...observed, unseen]));
    expect(next).not.toContain("unprocessed evidence");
    expect(next).toContain("new unseen evidence");
  });

  it.each(["", "x".repeat(1601)])("does not let an invalid note block reading or finishing, and never truncates it", async value => {
    const context = createWorkingMemoryContext(new MemoryLedger("s"), 8, "rewrite");
    const [read, finish] = context.wrapTools([stub, { ...stub, name: "finish" }]);
    await read!.execute("initial", { workingMemory: "Preserve this note." });
    await context.transformContext(observed);
    for (const tool of [read!, finish!]) {
      const result = await tool.execute("invalid-note", { workingMemory: value });
      expect(result.details.workingMemoryUpdate.rejected).toBe(true);
      expect(result.details.workingMemoryUpdate.acknowledgedToolCallIds).toEqual([]);
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("note was not updated") })]));
      expect(context.workingMemorySnapshot()).toMatchObject({ note: "Preserve this note.", revision: 1 });
      expect(JSON.stringify(await context.transformContext(observed))).toContain("unprocessed evidence");
    }
  });
});
