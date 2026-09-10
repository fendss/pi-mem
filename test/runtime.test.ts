import { describe, expect, it } from "vitest";
import {
  PI_MEM_TOOL_SYSTEM_PROMPT,
  PIMEM_MINIMAL_SKILL_HASH,
  PIMEM_MINIMAL_SKILL_TEXT,
  PIMEM_SKILL_HASH,
  PIMEM_SKILL_TEXT,
  piMemSystemPrompt,
} from "../src/evidence-agent/index.js";
import type { SearchOperatorCatalogEntry } from "../src/retrieval/index.js";

describe("runtime Skill experiment boundary", () => {
  it("keeps the default retrieval policy mechanics-only", () => {
    const none = piMemSystemPrompt("none");
    const minimal = piMemSystemPrompt("pimem-minimal");
    const current = piMemSystemPrompt("pimem-v0");

    expect(none).not.toContain("<active_skill");
    expect(minimal.startsWith(`${none}\n\n`)).toBe(false);
    expect(current.startsWith(`${none}\n\n`)).toBe(true);
    expect(minimal).toContain(PIMEM_MINIMAL_SKILL_TEXT);
    expect(current).toContain(PIMEM_SKILL_TEXT);
    expect(current).toContain('<active_skill name="pimem-retrieval"');
    expect(current).not.toMatch(
      /closed-slot|open-set|LongMemEval|benchmark|calendar-day/iu,
    );
    expect(none).toBe(PI_MEM_TOOL_SYSTEM_PROMPT);
    expect(PIMEM_SKILL_HASH).toMatch(/^[a-f0-9]{64}$/u);
    expect(PIMEM_MINIMAL_SKILL_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("adds progressive inline composition without task-specific routing", () => {
    expect(PIMEM_SKILL_TEXT).not.toBe(PIMEM_MINIMAL_SKILL_TEXT);
    expect(PIMEM_SKILL_TEXT).toContain(
      "without imposing a task-specific reasoning strategy",
    );
    expect(PIMEM_SKILL_TEXT).toContain("Search spans all source roles");
    expect(PIMEM_SKILL_TEXT).toContain(
      "`queries` only. Add `order` or `maxPerSession`",
    );
    expect(PIMEM_SKILL_TEXT).toContain(
      "hybrid primary path plus a lexical",
    );
    expect(PIMEM_SKILL_TEXT).toContain(
      "Useful evidence may be direct, analogous, or distributed across sources",
    );
    expect(PIMEM_SKILL_TEXT).toContain(
      "does not need to repeat the caller's requested answer verbatim",
    );
    expect(PIMEM_SKILL_TEXT).toContain(
      "Call `finish` by itself after observing the preceding tool results",
    );
    expect(PIMEM_SKILL_TEXT).not.toMatch(
      /closed-slot|open-set|temporal|list|count|LongMemEval|benchmark/iu,
    );
  });

  it("keeps the operator catalog out of the compact interface", () => {
    const catalog: SearchOperatorCatalogEntry[] = [{
      id: "entity-expand",
      version: "1",
      guide: {
        summary: "Follow entity associations.",
        useWhen: ["An entity anchor is available."],
        cost: "medium",
      },
    }];

    for (const skill of ["none", "pimem-v0"] as const) {
      const prompt = piMemSystemPrompt(skill, undefined, catalog);
      expect(prompt).toContain("id=entity-expand | version=1");
      expect(prompt).not.toContain("entity-expand@1");
    }
    expect(piMemSystemPrompt("pimem-minimal", undefined, catalog)).not.toContain(
      "entity-expand",
    );
  });
});
