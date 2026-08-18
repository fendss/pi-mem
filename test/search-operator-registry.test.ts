import { describe, expect, it } from "vitest";
import { MemoryLedger } from "../src/ledger.js";
import { createPiMemTools } from "../src/tools.js";
import {
  SearchOperatorRegistry,
  type MemoryToolStore,
  type SearchOperator,
} from "../src/retrieval/index.js";
import type { MemoryRecord } from "../src/memory/index.js";

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
});
