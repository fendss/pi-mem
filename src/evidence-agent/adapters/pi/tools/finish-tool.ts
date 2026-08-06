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
      "Submit an internally consistent evidence package. Cite candidate numbers returned by search/read; the harness converts them to exact source IDs, auto-reads selected candidates, and enforces provenance. Cover every independent evidence need. Keep citation supports atomic and source-local; make evidenceSummary a lossless ledger of those facts; keep inventory, count, summary, supports, and raw citations consistent. Do not generate the benchmark answer.",
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
      await options.beforeFinish?.(submitted);
      const selectedMemoryIds = [...new Set([
        ...submitted.citations.map((citation) => citation.memoryId),
        ...(submitted.inventory ?? []).flatMap((item) => item.memoryIds),
      ])];
      const autoReadMemoryIds = selectedMemoryIds.filter((memoryId) =>
        !options.ledger.hasRead(memoryId)
      );
      const autoReadCandidateRefs = autoReadMemoryIds.map((memoryId) =>
        options.ledger.candidateRef(memoryId)!
      );
      if (autoReadMemoryIds.length > 0) {
        const autoReadRecords = options.store.read(
          options.scopeId,
          autoReadMemoryIds,
          0,
          0,
        );
        options.ledger.recordRead(autoReadRecords);
      }
      const selection = options.ledger.acceptSelection(submitted);
      const details: FinishToolDetails = {
        kind: "finish",
        autoReadCandidateRefs,
        autoReadMemoryIds,
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
