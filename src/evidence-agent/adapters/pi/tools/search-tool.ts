import {
  createSearchMemory,
  renderSearchOperatorCatalog,
} from "../../../../retrieval/index.js";
import type { CreatePiMemToolsOptions, PiMemTools, SearchToolDetails } from "./contracts.js";
import { renderCandidates, renderEvidenceOperator } from "./render-tool-result.js";
import { createSearchParameters } from "./schemas.js";

export function createSearchTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["search"] {
  const searchMemory = createSearchMemory({
    operatorRegistry: options.operatorRegistry,
    scopeId: options.scopeId,
    ...(options.questionDate === undefined
      ? {}
      : { questionDate: options.questionDate }),
    ...(options.searchDefaults === undefined
      ? {}
      : { searchDefaults: options.searchDefaults }),
  });
  const operatorCatalog = options.operatorRegistry.list();
  const catalogText = renderSearchOperatorCatalog(operatorCatalog);
  return {
    name: "search",
    label: "Search memory",
    description: [
      "Run one Agent-selected search operator with focused queries. The harness never routes from question keywords or accepts SQL. Use returned candidate numbers with read.",
      catalogText,
    ].join("\n"),
    parameters: createSearchParameters(operatorCatalog.map((entry) => entry.id)),
    async execute(_toolCallId, params, signal) {
      const {
        request,
        operator,
        operatorVersion,
        hits,
        operatorResult,
        composition,
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
        operatorVersion,
        ...(operatorResult === undefined ? {} : { operatorResult }),
        ...(composition === undefined ? {} : { composition }),
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
