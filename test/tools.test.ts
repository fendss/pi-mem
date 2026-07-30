import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { MemoryLedger } from "../src/ledger.js";
import type { StoreSearchHit } from "../src/store.js";
import {
  createFinishOnlyBeforeToolCall,
  createPiMemTools,
  validateFinishToolBatch,
  type MemoryToolStore,
} from "../src/tools.js";
import type { MemoryRecord, SearchRequest } from "../src/types.js";

function record(memoryId: string, turnIndex: number): MemoryRecord {
  return {
    memoryId,
    scopeId: "scope-1",
    sessionId: "session-1",
    turnIndex,
    role: turnIndex % 2 === 0 ? "user" : "assistant",
    content: `source ${memoryId}`,
    contentHash: `hash-${memoryId}`,
    metadata: {},
  };
}

function createStore(
  searched: MemoryRecord,
  expanded: MemoryRecord,
): MemoryToolStore {
  return {
    search(_scopeId: string, request: SearchRequest): StoreSearchHit[] {
      return [
        {
          record: searched,
          query: request.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: searched.content,
        },
      ];
    },
    read(): MemoryRecord[] {
      return [searched, expanded];
    },
  };
}

describe("PiMem tools", () => {
  it("collects structured search and read candidates, including expansion", async () => {
    const searched = record("m1", 0);
    const expanded = record("m2", 1);
    const ledger = new MemoryLedger("scope-1");
    const tools = createPiMemTools({
      store: createStore(searched, expanded),
      scopeId: "scope-1",
      ledger,
    });

    const searchResult = await tools.search.execute("search-1", {
      queries: [" source ", "source"],
      limit: 10,
    });
    expect(searchResult.details.kind).toBe("search");
    expect(searchResult.details.request).toMatchObject({
      queries: ["source"],
      limit: 10,
      order: "relevance",
    });
    expect(searchResult.details.candidates).toEqual([
      expect.objectContaining({ memoryId: "m1", read: false }),
    ]);

    const readResult = await tools.read.execute("read-1", {
      candidateRefs: [1],
      contextBefore: 0,
      contextAfter: 1,
    });
    expect(readResult.details.kind).toBe("read");
    expect(readResult.details.expandedMemoryIds).toEqual(["m2"]);
    expect(readResult.details.candidates.map((item) => item.memoryId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(ledger.evidence.map((item) => item.memoryId)).toEqual(["m1", "m2"]);
    expect(
      ledger.candidates.find((item) => item.memoryId === "m2")?.discoveries,
    ).toEqual([expect.objectContaining({ tool: "read_expansion" })]);

    const finishResult = await tools.finish.execute("finish-1", {
      status: "sufficient",
      citations: [{ candidateRef: 2, supports: "The source states it." }],
      evidenceSummary: "The neighboring source turn provides the answer.",
    });
    expect(finishResult.terminate).toBe(true);
    expect(finishResult.details.selection.citations[0]?.memoryId).toBe("m2");
    expect(ledger.selection?.status).toBe("sufficient");
  });

  it("passes focused time controls and annotates relative time", async () => {
    const searched = {
      ...record("m-time", 0),
      timestamp: "2024-01-01T00:00:00",
    };
    let observed: SearchRequest | undefined;
    const store: MemoryToolStore = {
      search(_scopeId, request) {
        observed = request;
        return [{
          record: searched,
          query: request.queries[0] ?? "",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: searched.content,
        }];
      },
      read() {
        return [searched];
      },
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
      questionDate: "2024/01/03 (Wed) 00:00",
    });

    const result = await tools.search.execute("search-time", {
      queries: ["source"],
      order: "chronological",
      maxPerSession: 2,
    });

    expect(observed).toEqual({
      queries: ["source"],
      limit: 8,
      order: "chronological",
      maxPerSession: 2,
    });
    expect(JSON.stringify(result.content)).toContain(
      "2 days before question",
    );
  });

  it("dispatches explicit lexical and time-range operators without routing", async () => {
    const lexical = { ...record("m-lexical", 0), content: "Exact Product ZX-41" };
    const timed = {
      ...record("m-timed", 1),
      timestamp: "2024-02-01T00:00:00",
      content: "A source in the requested time range",
    };
    const calls: string[] = [];
    const store: MemoryToolStore = {
      search() {
        calls.push("relevance");
        return [];
      },
      searchLexical() {
        calls.push("lexical");
        return [{
          record: lexical,
          query: "Product ZX-41",
          retriever: "fts5",
          rank: 1,
          score: 1,
          preview: lexical.content,
        }];
      },
      scanTimeRange() {
        calls.push("time_range");
        return [{
          record: timed,
          query: "time range scan",
          retriever: "pimem-time-range",
          rank: 1,
          score: 1,
          preview: timed.content,
        }];
      },
      read(_scopeId, memoryIds) {
        return [lexical, timed].filter((item) => memoryIds.includes(item.memoryId));
      },
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
      question: "When did I get Product ZX-41?",
    });

    const lexicalResult = await tools.search.execute("lexical", {
      operator: "lexical",
      queries: ["Product ZX-41"],
    });
    const timeResult = await tools.search.execute("time", {
      operator: "time_range",
      after: "2024-02-01T00:00:00",
      before: "2024-02-02T00:00:00",
    });

    expect(calls).toEqual(["lexical", "time_range"]);
    expect(lexicalResult.details.operator).toBe("lexical");
    expect(timeResult.details.operator).toBe("time_range");
    expect(timeResult.details.request.order).toBe("chronological");
  });

  it("passes explicit numeric-fact filters and reducers to the harness", async () => {
    const numeric = {
      ...record("m-numeric", 0),
      timestamp: "2024-03-01T00:00:00",
      content: "I earned $25 selling a book.",
    };
    let observedContext: Parameters<NonNullable<MemoryToolStore["expandEvidenceOperator"]>>[2] | undefined;
    const store: MemoryToolStore = {
      search(_scopeId, request) {
        return [{
          record: numeric,
          query: request.queries[0] ?? "",
          retriever: "pimem-hybrid",
          rank: 1,
          score: 1,
          preview: numeric.content,
        }];
      },
      expandEvidenceOperator(_scopeId, _request, context, seeds) {
        observedContext = context;
        return seeds.map((seed) => ({
          ...seed,
          retriever: "pimem-numeric-facts-db" as const,
          operatorNumericFactIndexes: [0],
        }));
      },
      read() {
        return [numeric];
      },
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });

    const result = await tools.search.execute("numeric", {
      operator: "numeric_facts",
      queries: ["book earnings"],
      units: ["USD"],
      valueKinds: ["increment"],
      reduce: { operation: "sum", distinctBy: "memory" },
    });

    expect(observedContext).toMatchObject({
      operator: "numeric_facts",
      units: ["USD"],
      valueKinds: ["increment"],
      reduction: { operation: "sum", distinctBy: "memory" },
    });
    expect(result.details.operatorResult?.operator).toBe("numeric_facts");
    expect(result.details.operatorResult?.derived).toMatchObject({
      operation: "sum",
      value: 25,
      unit: "USD",
    });
  });

  it("uses session_expand for candidate discovery without promoting evidence", async () => {
    const first = record("m-session-1", 0);
    const neighbor = record("m-session-2", 1);
    const ledger = new MemoryLedger("scope-1");
    const tools = createPiMemTools({
      store: createStore(first, neighbor),
      scopeId: "scope-1",
      ledger,
    });
    await tools.search.execute("seed", { queries: ["source"] });
    const result = await tools.search.execute("expand", {
      operator: "session_expand",
      withinCandidateRefs: [1],
      contextBefore: 0,
      contextAfter: 1,
    });

    expect(result.details.operator).toBe("session_expand");
    expect(result.details.candidates.map((item) => item.memoryId)).toEqual([
      "m-session-1",
      "m-session-2",
    ]);
    expect(ledger.evidence).toEqual([]);
  });

  it("awaits asynchronous retrieval without changing the search schema", async () => {
    const searched = record("m-async", 0);
    let observedSignal: AbortSignal | undefined;
    const store: MemoryToolStore = {
      async search(_scopeId, request, signal) {
        observedSignal = signal;
        await Promise.resolve();
        return [{
          record: searched,
          query: request.queries[0] ?? "",
          retriever: "pimem-hybrid",
          rank: 1,
          score: 1 / 61 + 1 / 61,
          preview: searched.content,
        }];
      },
      read() {
        return [searched];
      },
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });
    const controller = new AbortController();

    const result = await tools.search.execute(
      "search-async",
      { queries: ["source"] },
      controller.signal,
    );

    expect(result.details.candidates[0]).toMatchObject({ memoryId: "m-async" });
    expect(observedSignal).toBe(controller.signal);
  });

  it("auto-reads exact cited candidates before accepting finish", async () => {
    const searched = record("m1", 0);
    const expanded = record("m2", 1);
    const ledger = new MemoryLedger("scope-1");
    const tools = createPiMemTools({
      store: createStore(searched, expanded),
      scopeId: "scope-1",
      ledger,
    });

    await tools.search.execute("search-1", { queries: ["source"] });
    const result = await tools.finish.execute("finish-1", {
      status: "sufficient",
      citations: [{ candidateRef: 1, supports: "The source states it." }],
      evidenceSummary: "The exact selected candidate supplies the evidence.",
    });

    expect(result.details.autoReadCandidateRefs).toEqual([1]);
    expect(result.details.autoReadMemoryIds).toEqual(["m1"]);
    expect(ledger.evidence.map((item) => item.memoryId)).toEqual(["m1", "m2"]);
    expect(ledger.selection?.citations[0]?.memoryId).toBe("m1");
  });

  it("lets an operator block finish before the ledger accepts it", async () => {
    const searched = record("m1", 0);
    const expanded = record("m2", 1);
    const ledger = new MemoryLedger("scope-1");
    const tools = createPiMemTools({
      store: createStore(searched, expanded),
      scopeId: "scope-1",
      ledger,
      beforeFinish: () => {
        throw new Error("run evidence exhaustion");
      },
    });
    await tools.search.execute("search-1", { queries: ["source"] });
    await tools.read.execute("read-1", { candidateRefs: [1] });

    await expect(
      tools.finish.execute("finish-1", {
        status: "sufficient",
        citations: [{ candidateRef: 1, supports: "Source says so." }],
        evidenceSummary: "A provisional summary.",
      }),
    ).rejects.toThrow(/evidence exhaustion/u);
    expect(ledger.selection).toBeUndefined();
  });

  it("accepts a cumulative scalar count without fabricated inventory rows", async () => {
    const searched = record("m-count", 0);
    const ledger = new MemoryLedger("scope-1");
    const tools = createPiMemTools({
      store: createStore(searched, record("m-neighbor", 1)),
      scopeId: "scope-1",
      ledger,
    });
    await tools.search.execute("search-count", { queries: ["restaurants"] });
    await tools.read.execute("read-count", { candidateRefs: [1] });

    const result = await tools.finish.execute("finish-count", {
      status: "sufficient",
      count: 4,
      inventory: [{ item: "cumulative count", candidateRefs: [1] }],
      citations: [{ candidateRef: 1, supports: "Tried four." }],
      evidenceSummary: "The source gives a cumulative count of four.",
    });

    expect(result.details.selection.count).toBe(4);
    expect(result.details.selection.inventory).toHaveLength(1);
  });

  it("allows multiple query variants and adaptive search depth", async () => {
    const searched = record("m-flexible", 0);
    const tools = createPiMemTools({
      store: createStore(searched, record("m-neighbor", 1)),
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });

    const first = await tools.search.execute("search-1", {
      queries: ["first entity", "second related entity"],
      limit: 40,
    });
    expect(first.details.request).toMatchObject({
      queries: ["first entity", "second related entity"],
      limit: 40,
    });
    await tools.search.execute("search-2", { queries: ["missing date"] });
    await tools.search.execute("search-3", { queries: ["state before update"] });
    await expect(
      tools.search.execute("search-4", { queries: ["exact hard negative"] }),
    ).resolves.toMatchObject({ details: { kind: "search" } });
  });

  it("audits punctuation-only query repeats without rejecting them", async () => {
    const searched = record("m-repeat", 0);
    const tools = createPiMemTools({
      store: createStore(searched, record("m-neighbor", 1)),
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });

    const first = await tools.search.execute("search-1", {
      queries: ["pages left in The Nightingale?"],
    });
    expect(first.details.repeatedQueries).toBeUndefined();

    const repeated = await tools.search.execute("search-repeat", {
      queries: ["Pages left in The Nightingale."],
    });
    expect(repeated.details.repeatedQueries).toEqual([
      "Pages left in The Nightingale.",
    ]);
  });

  it("defaults to relevance without inferring an operator from the question", async () => {
    const generic = {
      ...record("m-generic", 0),
      timestamp: "2023-03-10T10:00:00",
      content: "I bought a portable power bank.",
    };
    const target = {
      ...record("m-target", 0),
      sessionId: "session-target",
      timestamp: "2023-03-15T10:00:00",
      content: "I bought a smoker for the kitchen.",
    };
    const requests: SearchRequest[] = [];
    const store: MemoryToolStore = {
      search(_scopeId, request) {
        requests.push(request);
        const selected = request.after ? target : generic;
        return [{
          record: selected,
          query: request.queries[0] ?? "",
          retriever: "pimem-hybrid",
          rank: 1,
          score: 1,
          preview: selected.content,
        }];
      },
      read(_scopeId, memoryIds) {
        return [generic, target].filter((item) => memoryIds.includes(item.memoryId));
      },
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
      question: "What kitchen appliance did I buy 10 days ago?",
      questionDate: "2023/03/25 (Sat) 18:26",
      searchDefaults: { limit: 20, order: "relevance", maxPerSession: 4 },
    });

    const result = await tools.search.execute("search-temporal", {
      queries: ["kitchen appliance purchase"],
    });

    expect(requests).toHaveLength(1);
    expect(result.details.operator).toBe("relevance");
    expect(result.details.operatorApplied).toBe(false);
    expect(result.details.candidates[0]?.memoryId).toBe("m-generic");
    expect(JSON.stringify(result.content)).toContain("candidate_refs");
    expect(JSON.stringify(result.content)).not.toContain("temporal_plan");
  });

  it("keeps opaque memory IDs inside the harness and validates simple refs", async () => {
    const searched = {
      ...record("m-dd73e626e75c3cab75a9578f", 0),
      content: "source text without an internal identifier",
    };
    const tools = createPiMemTools({
      store: createStore(searched, record("m-neighbor", 1)),
      scopeId: "scope-1",
      ledger: new MemoryLedger("scope-1"),
    });
    const search = await tools.search.execute("search-1", { queries: ["source"] });

    expect(JSON.stringify(search.content)).not.toContain(searched.memoryId);
    expect(search.details.candidateReferences).toEqual([
      { candidateRef: 1, memoryId: searched.memoryId },
    ]);
    const zeroBased = await tools.read.execute("read-zero", {
      candidateRefs: [0],
    });
    expect(zeroBased.details.requestedCandidateRefs).toEqual([1]);
    expect(zeroBased.details.requestedMemoryIds).toEqual([searched.memoryId]);
    await expect(
      tools.read.execute("read-bad", { candidateRefs: [99] }),
    ).rejects.toThrow(/Valid candidate range is 1-2/u);
  });

  it("validates that finish is the only tool call in a turn", async () => {
    expect(validateFinishToolBatch(["finish"])).toBeUndefined();
    expect(validateFinishToolBatch(["search"])).toBeUndefined();
    expect(validateFinishToolBatch(["search", "finish"])).toMatch(
      /only tool call/u,
    );

    const hook = createFinishOnlyBeforeToolCall();
    const mixedContext = {
      assistantMessage: {
        content: [
          { type: "toolCall", id: "1", name: "search", arguments: {} },
          { type: "toolCall", id: "2", name: "finish", arguments: {} },
        ],
      },
      toolCall: { type: "toolCall", id: "1", name: "search", arguments: {} },
      args: {},
      context: { systemPrompt: "", messages: [], tools: [] },
    } as unknown as BeforeToolCallContext;

    await expect(hook(mixedContext)).resolves.toBeUndefined();

    const unsafeContext = {
      ...mixedContext,
      assistantMessage: {
        content: [
          { type: "toolCall", id: "2", name: "finish", arguments: {} },
          { type: "toolCall", id: "1", name: "search", arguments: {} },
        ],
      },
      toolCall: { type: "toolCall", id: "2", name: "finish", arguments: {} },
    } as unknown as BeforeToolCallContext;
    await expect(hook(unsafeContext)).resolves.toEqual({
      block: true,
      reason: "finish must be the final tool call in its turn",
    });
  });
});
