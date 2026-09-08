import type { MemoryCandidate } from "../../model/evidence.js";
import type { MemoryLedger } from "../../model/ledger.js";
import type { MemoryObservation } from "./memory-observation.js";
import { compactPreview, sha256 } from "../../../util.js";

/** Navigation deltas only. The context policy supplies the persistent note. */
export function createWorkingMemoryObservation(
  ledger: MemoryLedger,
  maxSearchCalls?: number,
  recordShown?: (ref: string, text: string) => void,
) {
  const displayed = new Set<string>();
  let searches = 0;
  let pending: Parameters<MemoryObservation["recordSearch"]>[0] | undefined;

  function renderFinding(candidate: MemoryCandidate, limit: number): string | undefined {
    const ref = ledger.candidateRef(candidate.candidateId);
    if (ref === undefined) return undefined;
    const text = compactPreview(candidate.passage?.content ?? candidate.preview, limit);
    // Include coordinates and displayed text: a known parent can expose a new fact.
    const identity = sha256(JSON.stringify([
      candidate.candidateId, candidate.passage?.sourceContentHash,
      candidate.passage?.start, candidate.passage?.end, text,
    ]));
    if (displayed.has(identity)) return undefined;
    displayed.add(identity);
    recordShown?.(ref, text);
    return `- read ${ref}${candidate.inspected ? " (previously read; new presentation)" : ""}` +
      `${candidate.timestamp === undefined ? "" : ` · ${candidate.timestamp}`}\n  ${text}`;
  }

  return {
    searchesRemaining: () => maxSearchCalls === undefined ? undefined : Math.max(0, maxSearchCalls - searches),
    // The wrapper commits notes once for every tool, including finish.
    recordWorkingMemory() {
      throw new Error("Working-memory notes must be committed by the context policy");
    },
    recordSearch(input) {
      if (input.countsAgainstSearchBudget !== false) searches += 1;
      pending = input;
    },
    render() {
      const current = pending;
      pending = undefined;
      const status = maxSearchCalls === undefined
        ? `Searches completed: ${searches}`
        : `Searches remaining: ${Math.max(0, maxSearchCalls - searches)}`;
      const findingLines = (current?.findings ?? []).flatMap((candidate) => {
        const line = renderFinding(candidate, candidate.passage?.content.length ?? 360);
        return line === undefined ? [] : [line];
      });
      const directory = current?.directoryFindings ?? [];
      const directoryLimit = Math.max(48, Math.min(128, Math.floor(6_000 / Math.max(1, directory.length))));
      const directoryLines = directory.flatMap((candidate) => {
        const line = renderFinding(candidate, directoryLimit);
        return line === undefined ? [] : [line];
      });
      return [
        "<MEMORY>", status,
        `Stored candidates: ${ledger.candidates.length}; read sources: ${ledger.inspectedEvidence.length}.`,
        ...(current === undefined ? [] : [
          "New or changed findings from this search",
          ...findingLines,
          "New or changed compact directory entries",
          ...directoryLines,
          ...(findingLines.length + directoryLines.length === 0
            ? ["No new displayed text. This does not prove that the required evidence is complete."] : []),
          ...(current.pagination?.hasMore
            ? ["search_more can expand the next page of this search. Existing C refs remain readable."] : []),
          ...(current.operatorEvidence ? [current.operatorEvidence] : []),
          ...(current.planTrace ? [current.planTrace] : []),
        ]),
        "Earlier candidate text is stored privately. Keep promising C refs and missing evidence in workingMemory; read a stored C ref to reopen its source.",
        "Every source returned by read still enters the final source package.",
        "</MEMORY>",
      ].join("\n");
    },
  } satisfies MemoryObservation & { searchesRemaining(): number | undefined };
}
