import { describe, expect, it } from "vitest";
import { episodicPreview } from "../src/util.js";

describe("episodic previews", () => {
  it("preserves setup and sentence-final facts within a fixed budget", () => {
    const text = `${"setup ".repeat(80)}By the way, my personal best is 25:50.`;
    const preview = episodicPreview(text, 120);

    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview).toMatch(/^setup/u);
    expect(preview).toContain("personal best is 25:50");
    expect(preview).toContain(" … ");
  });
});
