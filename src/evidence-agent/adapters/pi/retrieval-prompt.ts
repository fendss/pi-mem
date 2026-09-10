import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  renderSearchOperatorCatalog,
  type SearchOperatorCatalogEntry,
} from "../../../retrieval/index.js";
import { sha256 } from "../../../util.js";

export type PiMemSkill = "none" | "pimem-minimal" | "pimem-v0";

export const PIMEM_SKILL_VERSION = "pimem-v0-harness-context-13";
export const PIMEM_MINIMAL_SKILL_VERSION = "pimem-minimal-compact-interface-9";

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
- search returns navigation candidates across all source roles available in the current scope. Queries alone use the default retriever, while optional branches, ordering, and session diversity form one inline retrieval program. Source roles are harness-owned metadata, not search arguments. Previews are not source evidence.
- search_more reveals another bounded page from the most recent search without changing its operator or queries.
- read takes candidate handles from the current search result and adds bounded exact source evidence to the final source package. Read useful candidates before moving to another search. If workingMemory is available, keep only the supported facts and remaining gaps in plain text; the harness owns source handles, read receipts, and context retirement.
- finish reports status; evidenceSummary is an optional audit note that should normally be omitted. The harness automatically commits every exact source returned by read and generates citations, hashes, provenance, and answer-package formatting. Observe prior tool results, then call finish as the only tool call in that assistant turn.
- The harness owns source identity, provenance, package limits, and formatting.`;

export const PI_MEM_MINIMAL_TOOL_SYSTEM_PROMPT = `You are PiMem, a memory retrieval agent.

Find direct source evidence for the caller. Do not answer the question.

- search accepts focused queries and returns one bounded page of candidates. The harness owns retrieval strategy and keeps later pages private until search_more.
- read accepts a small set of visible candidate handles and returns exact source excerpts. The harness retains their full identity and provenance.
- Keep workingMemory short: only established facts and facts still missing. Do not copy handles, candidate lists, search history, or reasoning.
- Continue searching from the entity or relationship still missing. Call finish with sufficient only after the exact sources read cover the question.
- The harness commits all read sources and prepares the final evidence package.`;

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
  const minimal = skill === "pimem-minimal";
  const resolvedBasePrompt = basePrompt ?? (
    minimal ? PI_MEM_MINIMAL_TOOL_SYSTEM_PROMPT : PI_MEM_TOOL_SYSTEM_PROMPT
  );
  const catalogPrompt = minimal || operatorCatalog.length === 0
    ? ""
    : `<search_operator_catalog>\n${renderSearchOperatorCatalog(operatorCatalog)}\n</search_operator_catalog>`;
  return [
    resolvedBasePrompt,
    catalogPrompt,
    ...(skill === "none" ? [] : [activeSkillPrompt(skill)]),
  ].filter(Boolean).join("\n\n");
}
