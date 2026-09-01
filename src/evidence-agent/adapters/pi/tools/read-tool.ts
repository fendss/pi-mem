import type { CreatePiMemToolsOptions, PiMemTools, ReadToolDetails } from "./contracts.js";
import { uniqueCandidateRefs } from "./candidate-refs.js";
import { renderInspectedEvidence } from "./render-tool-result.js";
import {
  MAX_READ_RESULT_CHARS,
  projectMemoryEvidenceBatch,
  projectPassageEvidence,
  type MemoryEvidence,
} from "../../../model/source-evidence.js";
import { ReadParameters } from "./schemas.js";
import { candidateToolDetails } from "./candidate-details.js";

const DEFAULT_LOCAL_CONTEXT_TURNS = 1;

export function createReadTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["read"] {
  return {
    name: "read",
    label: "Read memory",
    description:
      "Read selected immutable sources into the final exact-source package using candidate handles such as C1. " +
      "The exact payload is retained privately under short E handles and every " +
      "source returned by read is automatically committed when finish succeeds. " +
      "One same-session turn on each side is included by default.",
    parameters: ReadParameters,
    async execute(_toolCallId, params) {
      if (params.workingMemory !== undefined) {
        options.observation?.recordWorkingMemory(params.workingMemory);
      }
      const candidateRefs = uniqueCandidateRefs(params.candidateRefs);
      if (options.ledger.candidates.length === 0) {
        return {
          content: [{ type: "text", text: "No candidates exist. Call search again; do not guess a candidate handle." }],
          details: {
            kind: "read",
            requestedCandidateRefs: candidateRefs,
            requestedMemoryIds: [],
            contextBefore: params.contextBefore ?? DEFAULT_LOCAL_CONTEXT_TURNS,
            contextAfter: params.contextAfter ?? DEFAULT_LOCAL_CONTEXT_TURNS,
            evidence: [],
            evidenceReferences: [],
            expandedMemoryIds: [],
            candidates: [],
          },
        };
      }
      const selectedCandidates = options.ledger.resolveCandidates(candidateRefs);
      const memoryIds = [...new Set(
        selectedCandidates.map((candidate) => candidate.memoryId),
      )];
      const contextBefore = params.contextBefore ?? DEFAULT_LOCAL_CONTEXT_TURNS;
      const contextAfter = params.contextAfter ?? DEFAULT_LOCAL_CONTEXT_TURNS;
      const memories = options.store.read(
        options.scopeId,
        memoryIds,
        contextBefore,
        contextAfter,
      );
      const memoriesById = new Map(
        memories.map((memory) => [memory.memoryId, memory]),
      );
      const exactPassages: Array<{
        evidence: MemoryEvidence;
        candidateId: string;
      }> = selectedCandidates.flatMap((candidate) => {
        if (candidate.passage === undefined) return [];
        const memory = memoriesById.get(candidate.memoryId);
        if (memory === undefined) {
          throw new Error(`Read did not return parent memory ${candidate.memoryId}`);
        }
        return [{
          evidence: projectPassageEvidence(memory, candidate.passage),
          candidateId: candidate.candidateId,
        }];
      });
      const passageParentIds = new Set(
        exactPassages.map((item) => item.evidence.memoryId),
      );
      const boundedRecords = memories.filter((memory) =>
        !passageParentIds.has(memory.memoryId)
      );
      const boundedEvidence = projectMemoryEvidenceBatch(boundedRecords, (memory) => {
        const candidates = options.ledger.selectMemoryCandidates([memory.memoryId]);
        return [
          ...(options.question === undefined ? [] : [options.question]),
          ...(options.evidenceFocus?.() ?? []),
          ...candidates.flatMap((candidate) =>
            candidate.discoveries.flatMap((discovery) =>
            discovery.query === undefined ? [] : [discovery.query]
          )),
        ];
      });
      const projected = [
        ...exactPassages.map((item) => item.evidence),
        ...boundedEvidence,
      ];
      const renderedChars = projected.reduce(
        (sum, evidence) => sum + evidence.content.length,
        0,
      );
      if (renderedChars > MAX_READ_RESULT_CHARS) {
        throw new Error(
          `Read result would exceed ${String(MAX_READ_RESULT_CHARS)} characters. ` +
            "Read fewer candidate passages or request less neighboring context.",
        );
      }
      const inspectedCandidateIds = selectedCandidates.map(
        (candidate) => candidate.candidateId,
      );
      const recorded = options.ledger.recordInspect(
        projected,
        undefined,
        inspectedCandidateIds,
      );
      const requested = new Set(memoryIds);
      const expandedMemoryIds = recorded
        .map((memory) => memory.memoryId)
        .filter((memoryId) => !requested.has(memoryId));
      const candidates = options.ledger.selectCandidates([
        ...inspectedCandidateIds,
        ...expandedMemoryIds,
      ]);
      const renderedCandidateIds = [
        ...exactPassages.map((item) => item.candidateId),
        ...boundedEvidence.map((memory) =>
          selectedCandidates.find((candidate) =>
            candidate.memoryId === memory.memoryId &&
            candidate.passage === undefined
          )?.candidateId ?? memory.memoryId
        ),
      ];
      const evidenceReferences = recorded.map((memory, index) => ({
        evidenceRef: options.ledger.evidenceRef(memory.memoryId)!,
        candidateRef: options.ledger.candidateRef(
          renderedCandidateIds[index] ?? memory.memoryId,
        )!,
        memoryId: memory.memoryId,
      }));
      const details: ReadToolDetails = {
        kind: "read",
        requestedCandidateRefs: candidateRefs,
        requestedMemoryIds: memoryIds,
        contextBefore,
        contextAfter,
        evidence: recorded.map((item) => ({
          memoryId: item.memoryId,
          scopeId: item.scopeId,
          sessionId: item.sessionId,
          turnIndex: item.turnIndex,
          contentHash: item.contentHash,
          sourceContentHash: item.sourceContentHash,
          sourceContentLength: item.sourceContentLength,
          truncated: item.truncated,
          excerpts: item.excerpts.map((excerpt) => ({
            start: excerpt.start,
            end: excerpt.end,
          })),
        })),
        evidenceReferences,
        expandedMemoryIds,
        candidates: candidateToolDetails(candidates),
      };
      return {
        content: [{
          type: "text",
          text: [
            "<READ_RESULT>",
            "Inspected exact evidence (visible for this reasoning turn and " +
              "retained privately in the evidence ledger; it will enter the final source package):",
            renderInspectedEvidence(
              recorded,
              options.ledger,
              options.questionDate,
              renderedCandidateIds,
            ),
            "Every exact source shown above will be committed when finish succeeds.",
            "</READ_RESULT>",
            ...(options.observation === undefined
              ? []
              : ["", options.observation.render()]),
          ].join("\n"),
        }],
        details,
      };
    },
  };
}
