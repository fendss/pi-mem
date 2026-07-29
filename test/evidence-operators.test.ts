import { describe, expect, it } from "vitest";
import { buildAggregateOperatorResult } from "../src/aggregate-operator.js";
import {
  buildTimelineOperatorResult,
  resolveTemporalQuestion,
  temporalAuxiliaryRequest,
} from "../src/timeline-operator.js";
import type { StoreSearchHit } from "../src/store.js";
import type { MemoryRecord, SearchRequest } from "../src/types.js";

function hit(
  memoryId: string,
  content: string,
  timestamp: string,
  options: { sessionId?: string; role?: MemoryRecord["role"]; query?: string } = {},
): StoreSearchHit {
  const record: MemoryRecord = {
    memoryId,
    scopeId: "scope-1",
    sessionId: options.sessionId ?? `session-${memoryId}`,
    turnIndex: 0,
    role: options.role ?? "user",
    content,
    timestamp,
    contentHash: `hash-${memoryId}`,
    metadata: {},
  };
  return {
    record,
    query: options.query ?? "source",
    retriever: "pimem-hybrid",
    rank: 1,
    score: 1,
    preview: content,
  };
}

describe("timeline evidence operator", () => {
  it("resolves relative dates against the question date and creates a bounded request", () => {
    const plan = resolveTemporalQuestion(
      "Now is 2023/03/25 (Sat) 18:26. What kitchen appliance did I buy 10 days ago?",
      "2023/03/25 (Sat) 18:26",
    );
    expect(plan.targets).toEqual([{
      expression: "10 days ago",
      date: "2023-03-15",
      basis: "relative-to-question",
    }]);

    const request: SearchRequest = {
      queries: ["kitchen appliance purchase"],
      limit: 20,
      order: "relevance",
      maxPerSession: 4,
    };
    expect(temporalAuxiliaryRequest(request, plan)).toEqual({
      ...request,
      after: "2023-03-15T00:00:00",
      before: "2023-03-15T23:59:59",
      order: "chronological",
    });
    expect(temporalAuxiliaryRequest({
      ...request,
      before: "2023-03-15T18:26:00Z",
    }, plan)).toMatchObject({
      after: "2023-03-15T00:00:00",
      before: "2023-03-15T18:26:00Z",
      order: "chronological",
    });
  });

  it("returns chronological source-grounded rows", () => {
    const result = buildTimelineOperatorResult(
      [
        hit("m-late", "The second event happened.", "2023-03-15T10:00:00"),
        hit("m-early", "The first event happened.", "2023-03-01T10:00:00"),
      ],
      "Which event happened first?",
      "2023/03/25 (Sat) 18:26",
    );
    expect(result.operator).toBe("timeline");
    expect(result.rows.map((row) => row.memoryId)).toEqual(["m-early", "m-late"]);
    expect(result.rows[0]).toMatchObject({ eventTime: "2023-03-01" });
  });
});

describe("aggregate evidence operator", () => {
  it("extracts, deduplicates, excludes targets, and proposes a grounded total", () => {
    const result = buildAggregateOperatorResult([
      hit("m-herbs", "I earned a total of $120 selling herbs.", "2023-05-01T10:00:00"),
      hit("m-jam", "I earned $225 selling jam.", "2023-05-08T10:00:00"),
      hit("m-plants", "I sold 20 potted plants for $7.5 each.", "2023-05-15T10:00:00"),
      hit("m-target", "I hope to earn $500 next time.", "2023-05-20T10:00:00"),
    ]);
    expect(result.operator).toBe("aggregate");
    expect(result.rows.map((row) => row.valueKind)).toEqual([
      "increment",
      "increment",
      "increment",
      "target",
    ]);
    expect(result.derived).toMatchObject({
      proposedTotal: 495,
      unit: "USD",
      excludedTargetCount: 1,
    });
  });

  it("uses the latest cumulative snapshot instead of summing snapshots", () => {
    const result = buildAggregateOperatorResult([
      hit("m-old", "I have earned $300 so far.", "2023-05-01T10:00:00"),
      hit("m-new", "I have earned $450 so far.", "2023-05-20T10:00:00"),
    ]);
    expect(result.derived).toMatchObject({
      latestCumulativeOrSnapshot: 450,
      latestUnit: "USD",
      latestMemoryId: "m-new",
    });
    expect(result.derived).not.toHaveProperty("proposedTotal");
  });
});
