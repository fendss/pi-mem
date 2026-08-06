import type { CreatePiMemToolsOptions, PiMemTools, ReadToolDetails } from "./contracts.js";
import { normalizeHarnessRefs } from "./candidate-refs.js";
import { renderMemories } from "./render-tool-result.js";
import { ReadParameters } from "./schemas.js";

export function createReadTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["read"] {
  return {
    name: "read",
    label: "Read memory",
    description:
      "Read selected immutable source memories using candidate numbers returned by search or bash_ro. The harness resolves them to exact internal IDs and records all context expansion. When a hit may omit its value, date, state, or adjacent reply, use bounded contextBefore/contextAfter. Use the same candidate numbers for citations in finish; there is no second evidence-number namespace.",
    parameters: ReadParameters,
    async execute(_toolCallId, params) {
      const candidateRefs = normalizeHarnessRefs(params.candidateRefs);
      if (options.ledger.candidates.length === 0) {
        return {
          content: [{ type: "text", text: "No candidates exist. Call search again; do not guess a candidate number." }],
          details: {
            kind: "read",
            requestedCandidateRefs: candidateRefs,
            requestedMemoryIds: [],
            contextBefore: params.contextBefore ?? 0,
            contextAfter: params.contextAfter ?? 0,
            memories: [],
            evidenceReferences: [],
            expandedMemoryIds: [],
            candidates: [],
          },
        };
      }
      const memoryIds = options.ledger.resolveCandidateRefs(candidateRefs);
      const contextBefore = params.contextBefore ?? 0;
      const contextAfter = params.contextAfter ?? 0;
      const memories = options.store.read(
        options.scopeId,
        memoryIds,
        contextBefore,
        contextAfter,
      );
      const recorded = options.ledger.recordRead(memories);
      const requested = new Set(memoryIds);
      const expandedMemoryIds = recorded
        .map((memory) => memory.memoryId)
        .filter((memoryId) => !requested.has(memoryId));
      const candidates = options.ledger.selectCandidates(
        recorded.map((memory) => memory.memoryId),
      );
      const evidenceReferences = recorded.map((memory) => ({
        evidenceRef: options.ledger.evidenceRef(memory.memoryId)!,
        candidateRef: options.ledger.candidateRef(memory.memoryId)!,
        memoryId: memory.memoryId,
      }));
      const details: ReadToolDetails = {
        kind: "read",
        requestedCandidateRefs: candidateRefs,
        requestedMemoryIds: memoryIds,
        contextBefore,
        contextAfter,
        memories: recorded,
        evidenceReferences,
        expandedMemoryIds,
        candidates,
      };
      return {
        content: [{
          type: "text",
          text: renderMemories(recorded, options.ledger, options.questionDate),
        }],
        details,
      };
    },
  };
}
