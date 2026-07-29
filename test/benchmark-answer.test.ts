import { describe, expect, it } from "vitest";
import { returnedModelMatches } from "../src/benchmark-answer.js";

describe("benchmark answer boundary", () => {
  it("accepts dated deployments of the requested model", () => {
    expect(
      returnedModelMatches("gpt-4o-mini", "gpt-4o-mini-2024-07-18"),
    ).toBe(true);
  });

  it("rejects provider model substitution", () => {
    expect(
      returnedModelMatches("gpt-4o-mini", "gpt-4.1-mini-2025-04-14"),
    ).toBe(false);
  });
});
