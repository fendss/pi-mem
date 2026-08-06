import { createSearchMemory } from "../../../../retrieval/index.js";
import type { CreatePiMemToolsOptions, PiMemTools, SearchToolDetails } from "./contracts.js";
import { renderCandidates, renderEvidenceOperator } from "./render-tool-result.js";
import { SearchParameters } from "./schemas.js";

export function createSearchTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["search"] {
  const searchMemory = createSearchMemory({
    store: options.store,
    scopeId: options.scopeId,
    ...(options.questionDate === undefined
      ? {}
      : { questionDate: options.questionDate }),
    ...(options.searchDefaults === undefined
      ? {}
      : { searchDefaults: options.searchDefaults }),
  });
  return {
    name: "search",
    label: "Search memory",
    description:
      "Run one Agent-selected retrieval operator with focused queries. Hybrid is broad recall; lexical is exact text; coverage aggregates independent queries across sessions; temporal joins date facts; numeric joins typed number facts; history returns user claims chronologically. The harness never routes from question keywords or accepts SQL. Use returned candidate numbers with read.",
    parameters: SearchParameters,
    async execute(_toolCallId, params, signal) {
      const {
        request,
        operator,
        hits,
        operatorResult,
        repeatedQueries,
      } = await searchMemory(params, signal);

      const candidates = options.ledger.recordSearchHits(hits);
      const candidateReferences = candidates.map((candidate) => ({
        candidateRef: options.ledger.candidateRef(candidate.memoryId)!,
        memoryId: candidate.memoryId,
      }));
      const details: SearchToolDetails = {
        kind: "search",
        request,
        operator,
        ...(operatorResult === undefined ? {} : { operatorResult }),
        candidateReferences,
        candidates,
        ...(repeatedQueries.length === 0 ? {} : { repeatedQueries }),
      };
      const rendered = [
        renderEvidenceOperator(operatorResult, options.ledger),
        renderCandidates(candidates, options.ledger, options.questionDate),
      ].filter(Boolean).join("\n");
      return {
        content: [{
          type: "text",
          text: options.searchGuidance
            ? `${options.searchGuidance}\n${rendered}`
            : rendered,
        }],
        details,
      };
    },
  };
}
