import { describe, expect, it } from "vitest";
import { MemoryLedger, createPiMemTools } from "../src/evidence-agent/index.js";
import {
  SearchOperatorRegistry,
  type MemoryToolStore,
  type SearchOperator,
} from "../src/retrieval/index.js";
import type { MemoryRecord } from "../src/memory/index.js";
import { createSelectedSearchOperatorRegistry } from "../src/composition/create-search-operator-registry.js";

function customOperator(memory: MemoryRecord): SearchOperator {
  return {
    id: "entity-expand",
    version: "1",
    guide: {
      summary: "Follow explicit entity associations.",
      useWhen: ["A known entity should lead to related source memories."],
      avoidWhen: ["No entity anchor is available."],
      cost: "medium",
    },
    async execute(context, input) {
      return {
        request: {
          queries: [...input.queries],
          limit: input.limit,
          order: "relevance",
        },
        hits: [{
          record: memory,
          query: input.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: memory.content,
        }],
      };
    },
  };
}

describe("SearchOperatorRegistry", () => {
  it("builds exactly the composition-selected built-in catalog", () => {
    const store: MemoryToolStore = {
      search: () => [],
      read: () => [],
    };
    const registry = createSelectedSearchOperatorRegistry(
      store,
      ["lexical", "coverage"],
    );

    expect(registry.list().map((entry) => entry.id)).toEqual([
      "lexical",
      "coverage",
    ]);
    expect(() => createSelectedSearchOperatorRegistry(store, []))
      .toThrow(/at least one built-in/iu);
    expect(() => createSelectedSearchOperatorRegistry(store, ["missing"]))
      .toThrow(/unknown built-in/iu);
  });

  it("makes a newly registered operator available without changing the tool or Skill", async () => {
    const memory: MemoryRecord = {
      memoryId: "memory-1",
      scopeId: "scope-1",
      sessionId: "session-1",
      turnIndex: 0,
      role: "user",
      content: "Alice introduced Bob to the project.",
      contentHash: "hash-1",
      metadata: {},
    };
    const registry = new SearchOperatorRegistry("entity-expand")
      .register(customOperator(memory))
      .freeze();
    const store: MemoryToolStore = {
      search() {
        throw new Error("The custom operator must own candidate discovery");
      },
      read() {
        return [memory];
      },
    };
    const tools = createPiMemTools({
      store,
      operatorRegistry: registry,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });

    expect(JSON.stringify(tools.search.parameters)).toContain("entity-expand");
    expect(tools.search.description).toContain("Follow explicit entity associations");

    const result = await tools.search.execute("search-custom", {
      operator: "entity-expand",
      queries: ["Alice Bob"],
      limit: 5,
    });

    expect(result.details).toMatchObject({
      operator: "entity-expand",
      operatorVersion: "1",
      candidates: [expect.objectContaining({ memoryId: "memory-1" })],
    });
  });

  it("rejects duplicate, unknown, and post-freeze registration", () => {
    const memory: MemoryRecord = {
      memoryId: "memory-1",
      scopeId: "scope-1",
      sessionId: "session-1",
      turnIndex: 0,
      role: "user",
      content: "source",
      contentHash: "hash-1",
      metadata: {},
    };
    const operator = customOperator(memory);
    const registry = new SearchOperatorRegistry("entity-expand")
      .register(operator);

    expect(() => registry.register(operator)).toThrow(/already registered/iu);
    expect(() => registry.list()).toThrow(/must be frozen/iu);
    registry.freeze();
    expect(() => registry.get("missing")).toThrow(/unknown search operator/iu);
    expect(() => registry.register({ ...operator, id: "another" })).toThrow(
      /registry is frozen/iu,
    );
  });

  it("keeps Agent-defined operators private to one run and composes CandidateSets", async () => {
    const memories = [
      { ...customMemory("memory-a"), content: "alpha" },
      { ...customMemory("memory-b"), content: "shared" },
      { ...customMemory("memory-c"), content: "gamma" },
    ];
    const base = new SearchOperatorRegistry("left")
      .register(hitListOperator("left", [memories[0]!, memories[1]!]))
      .register(hitListOperator("right", [memories[1]!, memories[2]!]))
      .freeze();
    const run = base.forkForRun();
    const sibling = base.forkForRun();

    const defined = run.define({
      id: "balanced-recall",
      version: "run-1",
      guide: {
        summary: "Fuse exact and semantic recall.",
        useWhen: ["Both recall paths are useful."],
        cost: "medium",
      },
      steps: [
        { id: "exact", kind: "search", operator: "left" },
        { id: "semantic", kind: "search", operator: "right" },
        {
          id: "fused",
          kind: "combine",
          inputs: ["exact", "semantic"],
          method: "rrf",
        },
      ],
      output: "fused",
    });
    const output = await run.get("balanced-recall").execute(
      { scopeId: "scope-1" },
      { queries: ["shared"], limit: 3 },
    );

    expect(defined.catalog).toMatchObject({ revision: 1 });
    expect(defined.definitionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(output.hits.map((hit) => hit.record.memoryId)).toEqual([
      "memory-b",
      "memory-a",
      "memory-c",
    ]);
    expect(output.composition).toMatchObject({
      definitionHash: defined.definitionHash,
      definitionRevision: 1,
      steps: [
        { id: "exact", candidateCount: 2 },
        { id: "semantic", candidateCount: 2 },
        { id: "fused", candidateCount: 3 },
      ],
    });
    expect(() => base.get("balanced-recall")).toThrow(/unknown/iu);
    expect(() => sibling.get("balanced-recall")).toThrow(/unknown/iu);
  });

  it("rejects unsafe or cognitively unbounded run definitions", () => {
    const base = new SearchOperatorRegistry("left")
      .register(hitListOperator("left", [customMemory("memory-a")]))
      .register(hitListOperator("right", [customMemory("memory-b")]))
      .register(hitListOperator("third", [customMemory("memory-c")]))
      .register(hitListOperator("fourth", [customMemory("memory-d")]))
      .register(hitListOperator("fifth", [customMemory("memory-e")]))
      .freeze();
    const run = base.forkForRun(2);

    expect(() => run.define({
      id: "forward-reference",
      version: "run-1",
      guide: { summary: "bad", useWhen: ["bad"], cost: "low" },
      steps: [{
        id: "fused",
        kind: "combine",
        inputs: ["later", "later"],
        method: "union",
      }, { id: "later", kind: "search", operator: "left" }],
      output: "fused",
    })).toThrow(/unavailable prior step/iu);
    expect(() => run.define({
      id: "recursive",
      version: "run-1",
      guide: { summary: "bad", useWhen: ["bad"], cost: "low" },
      steps: [{ id: "self", kind: "search", operator: "recursive" }],
      output: "self",
    })).toThrow(/cannot call itself/iu);
    expect(() => run.define({
      id: "unused-work",
      version: "run-1",
      guide: { summary: "bad", useWhen: ["bad"], cost: "low" },
      steps: [
        { id: "used", kind: "search", operator: "left" },
        { id: "unused", kind: "search", operator: "right" },
      ],
      output: "used",
    })).toThrow(/unused steps/iu);
    expect(() => run.define({
      id: "too-wide",
      version: "run-1",
      guide: { summary: "bad", useWhen: ["bad"], cost: "high" },
      steps: Array.from({ length: 5 }, (_, index) => ({
        id: `search-${index}`,
        kind: "search" as const,
        operator: ["left", "right", "third", "fourth", "fifth"][index]!,
      })),
      output: "search-4",
    })).toThrow(/at most 4 search steps/iu);
  });

  it("lets the Agent define and immediately invoke an operator through one small tool", async () => {
    const memory = customMemory("memory-1");
    const base = new SearchOperatorRegistry("left")
      .register(hitListOperator("left", [memory]))
      .freeze();
    const run = base.forkForRun();
    const store: MemoryToolStore = { search: () => [], read: () => [memory] };
    const tools = createPiMemTools({
      store,
      operatorRegistry: run,
      operatorDefinitions: run,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });

    expect(tools.defineOperator).toBeDefined();
    expect(JSON.stringify(tools.defineOperator!.parameters)).toContain("sources");
    expect(JSON.stringify(tools.defineOperator!.parameters)).not.toContain('"steps"');
    expect(JSON.stringify(tools.defineOperator!.parameters)).not.toContain('"output"');
    const definitionResult = await tools.defineOperator!.execute("define-1", {
      id: "focused-left",
      summary: "Reuse exact recall with a stable name.",
      sources: [{ operator: "left" }],
    });
    const searchResult = await tools.search.execute("search-1", {
      operator: "focused-left",
      queries: ["source"],
      limit: 5,
    });

    expect(definitionResult.details).toMatchObject({
      kind: "define_operator",
      definition: { id: "focused-left", catalog: { revision: 1 } },
      snapshot: {
        revision: 1,
        definition: { id: "focused-left", output: "source-1" },
      },
    });
    expect(searchResult.details).toMatchObject({
      operator: "focused-left",
      candidates: [expect.objectContaining({ memoryId: "memory-1" })],
      composition: { definitionRevision: 1 },
    });
    await expect(tools.defineOperator!.execute("define-2", {
      id: "nested",
      summary: "Do not permit recursive composition growth.",
      sources: [{ operator: "focused-left" }],
    })).rejects.toThrow(/initial catalog/iu);
  });
});

function customMemory(memoryId: string): MemoryRecord {
  return {
    memoryId,
    scopeId: "scope-1",
    sessionId: "session-1",
    turnIndex: 0,
    role: "user",
    content: memoryId,
    contentHash: `hash-${memoryId}`,
    metadata: {},
  };
}

function hitListOperator(
  id: string,
  memories: readonly MemoryRecord[],
): SearchOperator {
  return {
    id,
    version: "1",
    guide: { summary: id, useWhen: [id], cost: "low" },
    async execute(_context, input) {
      return {
        request: { queries: [...input.queries], limit: input.limit },
        hits: memories.map((memory, index) => ({
          record: memory,
          query: input.queries[0] ?? "",
          retriever: "fts5" as const,
          rank: index + 1,
          score: 1 / (index + 1),
          preview: memory.content,
        })),
      };
    },
  };
}
