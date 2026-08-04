import { describe, expect, it } from "vitest";
import { maximalMarginalRelevance } from "../src/mmr.js";

describe("deterministic MMR", () => {
  it("balances fused relevance against semantic duplication", () => {
    const selected = maximalMarginalRelevance([
      { id: "top", relevance: 1, text: "tea preference", vector: [1, 0] },
      { id: "duplicate", relevance: 0.99, text: "tea preference", vector: [1, 0] },
      { id: "diverse", relevance: 0.8, text: "travel event", vector: [0, 1] },
    ], 2, 0.5);

    expect(selected).toEqual([0, 2]);
  });

  it("uses token overlap when a sparse candidate has no semantic vector", () => {
    const selected = maximalMarginalRelevance([
      { id: "a", relevance: 1, text: "likes green tea" },
      { id: "b", relevance: 0.95, text: "likes green tea" },
      { id: "c", relevance: 0.8, text: "visited Kyoto in May" },
    ], 2, 0.5);

    expect(selected).toEqual([0, 2]);
  });

  it("validates limits, lambda, IDs, and vector dimensions", () => {
    expect(() => maximalMarginalRelevance([], -1)).toThrow(/limit/u);
    expect(() => maximalMarginalRelevance([], 1, 2)).toThrow(/lambda/u);
    expect(() => maximalMarginalRelevance([
      { id: "same", relevance: 1, text: "a" },
      { id: "same", relevance: 0, text: "b" },
    ], 1)).toThrow(/unique/u);
    expect(() => maximalMarginalRelevance([
      { id: "a", relevance: 1, text: "a", vector: [1, 0] },
      { id: "b", relevance: 0, text: "b", vector: [1] },
    ], 2)).toThrow(/dimensions/u);
  });
});
