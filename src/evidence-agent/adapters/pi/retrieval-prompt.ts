import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderSearchOperatorCatalog,
  type SearchOperatorCatalogEntry,
} from "../../../retrieval/index.js";
import { sha256 } from "../../../util.js";

export type PiMemSkill = "none" | "pimem-v0";

export const PIMEM_SKILL_VERSION = "pimem-v0-runtime-operators-1";

const DEFAULT_SKILL_PATH = fileURLToPath(
  new URL("../../../../.agents/skills/pimem-retrieval/SKILL.md", import.meta.url),
);

export const PIMEM_SKILL_TEXT = readFileSync(DEFAULT_SKILL_PATH, "utf8");
export const PIMEM_SKILL_HASH = sha256(PIMEM_SKILL_TEXT);

export const PI_MEM_BASE_SYSTEM_PROMPT = `You are PiMem: a memory retrieval and evidence-selection agent.

Your only task is to locate immutable source memories relevant to the caller's question and return a compact cited evidence package. Do not generate or format the caller's final response. Different callers apply different response protocols after retrieval.

Evidence policy:
- Match question typos to the exact intended entity while treating merely similar entities as distractors.
- Select direct source observations for every required subclaim.
- Preserve exact names, titles, places, labels, values, source roles, and timestamps in the evidence summary.
- Reconstruct temporal or update chains when the requested slot depends on order.
- If a required entity or component remains unsupported after focused searches, mark the package insufficient rather than guessing or substituting zero.

Tool policy:
- search previews are ephemeral navigation. They remain in the audit trace but expire from active model context after one turn.
- read only selected evidence. Oversized memories are exposed as bounded exact
  excerpts tied to the immutable source hash. Every cited memory must be read.
- old read text is compacted after one reasoning turn; re-read a candidate when
  exact wording is needed again.
- bash_ro is a focused last resort for exact matching, not a mandatory full-scope scan. Its output is navigation and also expires.
- Call finish alone with status, concise evidenceSummary, and citations. Count and inventory are optional evidence metadata.
`;

function activeSkillPrompt(): string {
  return `<active_skill name="pimem-retrieval" version="${PIMEM_SKILL_VERSION}">\n${PIMEM_SKILL_TEXT}\n</active_skill>`;
}

export function piMemSystemPrompt(
  skill: PiMemSkill = "pimem-v0",
  basePrompt: string = PI_MEM_BASE_SYSTEM_PROMPT,
  operatorCatalog: readonly SearchOperatorCatalogEntry[] = [],
): string {
  const catalogPrompt = operatorCatalog.length === 0
    ? ""
    : `<search_operator_catalog>\n${renderSearchOperatorCatalog(operatorCatalog)}\n</search_operator_catalog>`;
  return [
    basePrompt,
    catalogPrompt,
    ...(skill === "none" ? [] : [activeSkillPrompt()]),
  ].filter(Boolean).join("\n\n");
}
