import { describe, expect, it } from "vitest";
import { createSearchOperatorRegistry } from "../src/composition/create-search-operator-registry.js";
import {
  createPiMemTools,
  type MemoryToolStore,
} from "../src/evidence-agent/adapters/pi/tools.js";
import { MemoryLedger } from "../src/evidence-agent/model/ledger.js";
import type { MemoryRecord } from "../src/memory/index.js";

function source(index: number, content = `Fact ${String(index)}.`): MemoryRecord {
  return {
    memoryId: `m${String(index)}`,
    scopeId: "compact-scope",
    sessionId: `s${String(index)}`,
    turnIndex: 0,
    role: "user",
    content,
    contentHash: `hash-${String(index)}`,
    metadata: {},
  };
}

describe("compact agent interface", () => {
  it("keeps advanced controls private and pages a bounded candidate view", async () => {
    const records = Array.from({ length: 30 }, (_, index) => source(index + 1));
    const store: MemoryToolStore = {
      search(_scopeId, request) {
        return records.map((record, index) => ({
          record,
          query: request.queries[0]!,
          retriever: "fts5",
          rank: index + 1,
          score: 1 / (index + 1),
          preview: record.content,
        }));
      },
      read(_scopeId, memoryIds) {
        return records.filter((record) => memoryIds.includes(record.memoryId));
      },
    };
    const tools = createPiMemTools({
      store,
      operatorRegistry: createSearchOperatorRegistry(store),
      scopeId: "compact-scope",
      ledger: new MemoryLedger("compact-scope"),
      maxSearchCalls: 4,
      interfaceMode: "compact",
    });

    expect(tools.all.map((tool) => tool.name)).toEqual([
      "search",
      "search_more",
      "read",
      "finish",
    ]);
    expect(Object.keys(tools.search.parameters.properties!)).toEqual(["queries"]);
    expect(Object.keys(tools.read.parameters.properties!)).toEqual([
      "candidateRefs",
    ]);
    expect(Object.keys(tools.finish.parameters.properties!)).toEqual(["status"]);

    const first = await tools.search.execute("search-1", { queries: ["Fact"] });
    const firstText = JSON.stringify(first.content);
    expect(firstText).toContain("Current search results");
    expect(firstText).toContain("read C1");
    expect(firstText).toContain("read C20");
    expect(firstText).not.toContain("read C21");
    expect(firstText).not.toContain("Latest retrieval frontier");
    expect(firstText).not.toContain("Caller question");

    const second = await tools.searchMore.execute("more-1", {});
    const secondText = JSON.stringify(second.content);
    expect(secondText).toContain("read C21");
    expect(secondText).toContain("read C30");
  });

  it("uses no neighboring turns and bounds exact read output", async () => {
    const long = source(
      1,
      `${"irrelevant context ".repeat(2_000)}The requested compact fact is here.`,
    );
    let context: {
      before: number | undefined;
      after: number | undefined;
    } | undefined;
    const store: MemoryToolStore = {
      search(_scopeId, request) {
        return [{
          record: long,
          query: request.queries[0]!,
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: "The requested compact fact is here.",
        }];
      },
      read(_scopeId, _memoryIds, before, after) {
        context = { before, after };
        return [long];
      },
    };
    const tools = createPiMemTools({
      store,
      operatorRegistry: createSearchOperatorRegistry(store),
      scopeId: "compact-scope",
      ledger: new MemoryLedger("compact-scope"),
      interfaceMode: "compact",
    });
    await tools.search.execute("search-1", {
      queries: ["requested compact fact"],
    });
    const result = await tools.read.execute("read-1", {
      candidateRefs: ["C1"],
    });

    expect(context).toEqual({ before: 0, after: 0 });
    expect(result.details.contextBefore).toBe(0);
    expect(result.details.contextAfter).toBe(0);
    expect(JSON.stringify(result.content).length).toBeLessThan(15_000);
  });
});
