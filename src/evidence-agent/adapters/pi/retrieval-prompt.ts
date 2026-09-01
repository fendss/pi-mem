import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderSearchOperatorCatalog,
  type SearchOperatorCatalogEntry,
} from "../../../retrieval/index.js";
import { sha256 } from "../../../util.js";

export type PiMemSkill = "none" | "pimem-minimal" | "pimem-v0";

export const PIMEM_SKILL_VERSION = "pimem-v0-auto-read-commit-9";
export const PIMEM_MINIMAL_SKILL_VERSION = "pimem-minimal-auto-read-commit-5";

const DEFAULT_SKILL_PATH = fileURLToPath(
  new URL("../../../../.agents/skills/pimem-retrieval/SKILL.md", import.meta.url),
);

export const PIMEM_SKILL_TEXT = readFileSync(DEFAULT_SKILL_PATH, "utf8");
export const PIMEM_SKILL_HASH = sha256(PIMEM_SKILL_TEXT);

const MINIMAL_SKILL_PATH = fileURLToPath(
  new URL(
    "../../../../.agents/skills/pimem-retrieval-minimal/SKILL.md",
    import.meta.url,
  ),
);

export const PIMEM_MINIMAL_SKILL_TEXT = readFileSync(
  MINIMAL_SKILL_PATH,
  "utf8",
);
export const PIMEM_MINIMAL_SKILL_HASH = sha256(PIMEM_MINIMAL_SKILL_TEXT);

export const PI_MEM_TOOL_SYSTEM_PROMPT = `You are PiMem: a memory retrieval agent.

Your task is to locate source memories that may help a downstream model answer the caller's question. Do not answer or format the caller's final response.

Tool contract:
- search returns navigation candidates; queries alone use the default retriever, while optional branches, role filters, ordering, and session diversity form one inline retrieval program. Previews are not source evidence.
- search_more reveals another bounded page from the most recent search without changing its operator or queries.
- read takes candidate handles and adds bounded exact source evidence to the final source package under short E handles. Read only sources that may be useful downstream. If retrieval continues, preserve useful facts with their E handles in workingMemory because raw read payloads are shown for one reasoning turn.
- finish reports status and a compact retrieval note. The harness automatically commits every exact source returned by read and generates citations, hashes, provenance, and answer-package formatting. Observe prior tool results, then call finish as the only tool call in that assistant turn.
- The harness owns source identity, provenance, package limits, and formatting.`;

function activeSkillPrompt(skill: Exclude<PiMemSkill, "none">): string {
  const minimal = skill === "pimem-minimal";
  const name = minimal ? "pimem-retrieval-minimal" : "pimem-retrieval";
  const version = minimal ? PIMEM_MINIMAL_SKILL_VERSION : PIMEM_SKILL_VERSION;
  const text = minimal ? PIMEM_MINIMAL_SKILL_TEXT : PIMEM_SKILL_TEXT;
  return `<active_skill name="${name}" version="${version}">\n${text}\n</active_skill>`;
}

export function piMemSystemPrompt(
  skill: PiMemSkill = "pimem-v0",
  basePrompt?: string,
  operatorCatalog: readonly SearchOperatorCatalogEntry[] = [],
): string {
  const resolvedBasePrompt = basePrompt ?? PI_MEM_TOOL_SYSTEM_PROMPT;
  const catalogPrompt = operatorCatalog.length === 0
    ? ""
    : `<search_operator_catalog>\n${renderSearchOperatorCatalog(operatorCatalog)}\n</search_operator_catalog>`;
  return [
    resolvedBasePrompt,
    catalogPrompt,
    ...(skill === "none" ? [] : [activeSkillPrompt(skill)]),
  ].filter(Boolean).join("\n\n");
}
