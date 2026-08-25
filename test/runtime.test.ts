import { describe, expect, it } from "vitest";
import {
  PIMEM_SKILL_HASH,
  PIMEM_SKILL_TEXT,
  piMemSystemPrompt,
} from "../src/evidence-agent/index.js";
import type { SearchOperatorCatalogEntry } from "../src/retrieval/index.js";

describe("runtime Skill experiment boundary", () => {
  it("changes only the Skill suffix between none and pimem-v0", () => {
    const baseline = piMemSystemPrompt("none");
    const treatment = piMemSystemPrompt("pimem-v0");

    expect(baseline).not.toContain("<active_skill");
    expect(baseline).not.toContain(PIMEM_SKILL_TEXT);
    expect(treatment.startsWith(`${baseline}\n\n`)).toBe(true);
    expect(treatment).toContain('<active_skill name="pimem-retrieval"');
    expect(treatment).toContain(PIMEM_SKILL_TEXT);
    expect(PIMEM_SKILL_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("gives both experiment arms the same runtime catalog and only Skill adds routing policy", () => {
    const catalog: SearchOperatorCatalogEntry[] = [{
      id: "entity-expand",
      version: "1",
      guide: {
        summary: "Follow entity associations.",
        useWhen: ["An entity anchor is available."],
        cost: "medium",
      },
    }];
    const baseline = piMemSystemPrompt("none", undefined, catalog);
    const treatment = piMemSystemPrompt("pimem-v0", undefined, catalog);

    expect(baseline).toContain("entity-expand@1");
    expect(treatment.startsWith(`${baseline}\n\n`)).toBe(true);
    expect(treatment).toContain("select the catalog operator");
    expect(PIMEM_SKILL_TEXT).not.toMatch(/`(?:hybrid|lexical|coverage)`/u);
  });
});
