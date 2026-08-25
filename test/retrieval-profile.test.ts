import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRIEVAL_PROFILE,
  parseRetrievalProfile,
} from "../src/retrieval/retrieval-profile.js";

describe("retrieval profile selection", () => {
  it("keeps FTS5 as the default", () => {
    expect(DEFAULT_RETRIEVAL_PROFILE).toBe("fts5");
    expect(parseRetrievalProfile(undefined)).toBe("fts5");
    expect(parseRetrievalProfile("  ")).toBe("fts5");
  });

  it("accepts only explicit stable profile IDs", () => {
    expect(parseRetrievalProfile("pimem-hybrid"))
      .toBe("pimem-hybrid");
    expect(() => parseRetrievalProfile("hybrid"))
      .toThrow(/expected fts5 or pimem-hybrid/u);
  });
});
