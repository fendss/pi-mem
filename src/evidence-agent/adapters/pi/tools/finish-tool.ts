import type { PiMemSelection } from "../../../index.js";
import { normalizeHarnessRefs } from "./candidate-refs.js";
import type { CreatePiMemToolsOptions, FinishToolDetails, PiMemTools } from "./contracts.js";
import { FinishParameters } from "./schemas.js";

export function createFinishTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["finish"] {
  return {
    name: "finish",
    label: "Finish",
    description:
      "Submit an internally consistent evidence package. Cite only candidate numbers that were explicitly read in this run; the harness converts them to exact source IDs and enforces provenance. Cover every independent evidence need. Keep citation supports atomic and source-local; make evidenceSummary a lossless ledger of those facts; keep inventory, count, summary, supports, and raw citations consistent. Do not generate the caller's final response.",
    parameters: FinishParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const submitted: PiMemSelection = {
        status: params.status,
        citations: params.citations.map((citation) => ({
          memoryId: options.ledger.resolveCandidateRefs(
            normalizeHarnessRefs([citation.candidateRef]),
          )[0]!,
          supports: citation.supports,
        })),
        evidenceSummary: params.evidenceSummary,
        ...(params.count === undefined ? {} : { count: params.count }),
        ...(params.inventory === undefined
          ? {}
          : {
              inventory: params.inventory.map((item) => ({
                item: item.item,
                memoryIds: options.ledger.resolveCandidateRefs(
                  normalizeHarnessRefs(item.candidateRefs),
                ),
              })),
            }),
      };
      const selectedMemoryIds = [...new Set([
        ...submitted.citations.map((citation) => citation.memoryId),
        ...(submitted.inventory ?? []).flatMap((item) => item.memoryIds),
      ])];
      const unreadMemoryIds = selectedMemoryIds.filter((memoryId) =>
        !options.ledger.hasRead(memoryId)
      );
      if (unreadMemoryIds.length > 0) {
        const unreadCandidateRefs = unreadMemoryIds.map((memoryId) =>
          options.ledger.candidateRef(memoryId)!
        );
        throw new Error(
          `Finish rejected: candidate ${unreadCandidateRefs.length === 1 ? "reference" : "references"} ` +
            `${unreadCandidateRefs.join(", ")} ${unreadCandidateRefs.length === 1 ? "has" : "have"} not been read. ` +
            "Call read for every cited or inventoried candidate before calling finish.",
        );
      }
      await options.beforeFinish?.(submitted);
      const selection = options.ledger.acceptSelection(submitted);
      const details: FinishToolDetails = {
        kind: "finish",
        selection,
      };
      return {
        content: [{ type: "text", text: "Evidence selection accepted." }],
        details,
        terminate: true,
      };
    },
  };
}
