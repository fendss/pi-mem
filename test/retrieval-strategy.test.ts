import { describe, expect, it } from "vitest";
import {
  cleanMemoryQuestion,
  planMemoryQuestion,
  renderMemoryQuestionPlan,
} from "../src/retrieval-strategy.js";

const PREFIX = "Now is 2023/05/30 (Tue) 19:13. Please answer the question: ";

describe("memory retrieval strategy", () => {
  it("removes the LongMemEval wrapper before searching", () => {
    expect(cleanMemoryQuestion(`${PREFIX}Where do I currently live?`)).toBe(
      "Where do I currently live?",
    );
  });

  it("provides broad defaults and question-shaped attention without a search budget", () => {
    expect(
      planMemoryQuestion(`${PREFIX}How long before my current role did I leave?`),
    ).toEqual({
      cleanedQuestion: "How long before my current role did I leave?",
      defaultLimit: 20,
      defaultMaxPerSession: 4,
      defaultOrder: "relevance",
      evidenceFocus: ["knowledge-update", "temporal"],
    });
  });

  it("renders temporal evidence attention while preserving search freedom", () => {
    const rendered = renderMemoryQuestionPlan(
      "What is the order of 'event alpha' and 'event beta'?",
    );

    expect(rendered).toContain("Question-shaped retrieval attention");
    expect(rendered).toContain("query shape, filters, ordering, and search depth remain adaptive");
    expect(rendered).toContain("temporal attention");
    expect(rendered).toContain("relation-bearing neighbors");
    expect(rendered).toContain("exact-entity hard negatives");
    expect(rendered).not.toContain("exactly one query");
    expect(rendered).not.toContain("hard budget");
    expect(rendered).not.toContain("forbidden");
  });

  it("highlights aggregate and preference evidence rather than generic advice", () => {
    const rendered = renderMemoryQuestionPlan(
      "Can you suggest recipes, and how many did I already try?",
    );

    expect(rendered).toContain("aggregate attention");
    expect(rendered).toContain("preference attention");
    expect(rendered).toContain("rather than generic advice");
  });
});
