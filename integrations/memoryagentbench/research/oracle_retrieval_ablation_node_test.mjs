import assert from "node:assert/strict";
import test from "node:test";
import {
  coverage,
  extractSemanticCalls,
  observedCandidateIds,
  observedRetrievalCandidateIds,
  oracleCoverageOrder,
  queryDateLiterals,
  rrfFuse,
} from "./oracle_retrieval_ablation.mjs";

test("extractSemanticCalls flattens an inline plan but ignores continuation pages", () => {
  const audit = {
    retrieval: {
      trace: [
        {
          step: 1,
          toolName: "search",
          isError: false,
          details: {
            kind: "search",
            request: { queries: ["fallback"], limit: 20 },
            composition: {
              steps: [
                { kind: "search", operator: "hybrid", queries: ["alpha"] },
                { kind: "search", operator: "lexical", queries: ["beta"] },
                { kind: "combine", method: "rrf" },
              ],
            },
          },
        },
        {
          step: 2,
          toolName: "search_more",
          isError: false,
          details: { kind: "search", request: { queries: ["fallback"] } },
        },
      ],
    },
  };
  assert.deepEqual(extractSemanticCalls(audit), [{
    step: 1,
    queries: ["alpha", "beta"],
    filters: {},
    originalLimit: 20,
  }]);
});

test("observedCandidateIds keeps first exposure order and deduplicates pages", () => {
  const audit = {
    retrieval: {
      trace: [
        { details: { kind: "search", candidates: [{ memoryId: "m2" }, { memoryId: "m1" }] } },
        { details: { kind: "read", candidates: [{ memoryId: "ignored" }] } },
        { details: { kind: "search", candidates: [{ memoryId: "m1" }, { memoryId: "m3" }] } },
      ],
    },
  };
  assert.deepEqual(observedCandidateIds(audit), ["m2", "m1", "m3"]);
  assert.deepEqual(
    observedRetrievalCandidateIds(audit),
    ["m2", "m1", "ignored", "m3"],
  );
});

test("rrfFuse rewards agreement and remains deterministic on ties", () => {
  assert.deepEqual(
    rrfFuse([["a", "b", "c"], ["b", "d", "a"]], 3),
    ["b", "a", "d"],
  );
});

test("queryDateLiterals uses only dates already present in Agent queries", () => {
  assert.deepEqual(queryDateLiterals([
    { queries: ["bought on 2023-03-15", "2023/03/15", "ten days ago"] },
    { queries: ["before 2023-04-02"] },
  ]), ["2023-03-15", "2023-04-02"]);
});

test("coverage treats each gold group as alternatives, not cumulative requirements", () => {
  const records = new Map([
    ["a2", { sessionId: "s1" }],
    ["b1", { sessionId: "s2" }],
  ]);
  assert.deepEqual(
    coverage(["a2", "b1"], [["a1", "a2"], ["b1"]], records),
    {
      candidate_count: 2,
      distinct_sessions: 2,
      covered_gold_groups: 2,
      gold_group_count: 2,
      gold_any: true,
      gold_all: true,
      gold_group_best_ranks: [1, 2],
      candidate_ids: ["a2", "b1"],
    },
  );
});

test("oracleCoverageOrder selects one available representative per group", () => {
  const source = ["noise", "a2", "a1", "b1", "tail"];
  assert.deepEqual(
    oracleCoverageOrder(source, [["a1", "a2"], ["missing"], ["b1"]], 3),
    ["a2", "b1", "noise"],
  );
});
