import type { MemoryCandidate } from "../../model/evidence.js";
import type { MemoryLedger } from "../../model/ledger.js";
import type { MemoryObservation } from "./memory-observation.js";
import { compactPreview, queryCenteredEpisodicPreview, sha256 } from "../../../util.js";

interface WorkingMemoryObservationOptions {
  recordShown?: (ref: string, text: string) => void;
  /** Re-expose the current result when earlier observations can leave context. */
  refreshResults?: boolean;
  /** Keep only the current ranked page and the next legal actions model-visible. */
  compact?: boolean;
}

/** Navigation deltas only. The context policy supplies the persistent note. */
export function createWorkingMemoryObservation(
  ledger: MemoryLedger,
  maxSearchCalls?: number,
  options: WorkingMemoryObservationOptions = {},
) {
  const displayed = new Set<string>();
  let searches = 0;
  let pending: Parameters<MemoryObservation["recordSearch"]>[0] | undefined;

  function renderFinding(candidate: MemoryCandidate, limit: number): string | undefined {
    const ref = ledger.candidateRef(candidate.candidateId);
    if (ref === undefined) return undefined;
    const preview = candidate.passage?.content ?? candidate.preview;
    const queries = candidate.discoveries.flatMap(d => d.query ? [d.query] : []).slice(-2);
    const text = options.refreshResults
      ? queryCenteredEpisodicPreview(preview, queries.join(" "), limit)
      : compactPreview(preview, limit);
    // Include coordinates and displayed text: a known parent can expose a new fact.
    const identity = sha256(JSON.stringify([
      candidate.candidateId, candidate.passage?.sourceContentHash,
      candidate.passage?.start, candidate.passage?.end, text,
    ]));
    if (displayed.has(identity)) return undefined;
    displayed.add(identity);
    options.recordShown?.(ref, text);
    return `- read ${ref}${candidate.inspected ? (options.refreshResults ? " (previously read)" : " (previously read; new presentation)") : ""}` +
      `${options.refreshResults ? ` · ${candidate.role}` : ""}` +
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
      // Deduplicate within this result only; a prior display is not current visibility.
      if (options.refreshResults) displayed.clear();
      const status = maxSearchCalls === undefined
        ? `Searches completed: ${searches}`
        : `Searches remaining: ${Math.max(0, maxSearchCalls - searches)}`;
      if (options.compact) {
        const findingLines = (current?.findings ?? []).flatMap((candidate) => {
          const line = renderFinding(candidate, 280);
          return line === undefined ? [] : [line];
        });
        return [
          "<MEMORY>",
          status,
          ...(current === undefined
            ? []
            : [
                "Current search results",
                ...findingLines,
                ...(findingLines.length === 0
                  ? ["No candidate text was returned for this page."]
                  : []),
                ...(current.pagination?.hasMore
                  ? ["More results are available through search_more."]
                  : []),
              ]),
          "Read only promising candidates. Search for a missing fact, or finish when the exact sources read cover the question.",
          "</MEMORY>",
        ].join("\n");
      }
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
          options.refreshResults ? "Findings from this search" : "New or changed findings from this search",
          ...findingLines,
          options.refreshResults ? "Compact directory from this search" : "New or changed compact directory entries",
          ...directoryLines,
          ...(findingLines.length + directoryLines.length === 0
            ? ["No new displayed text. This does not prove that the required evidence is complete."] : []),
          ...(current.pagination?.hasMore
            ? ["search_more can expand the next page of this search. Existing C refs remain readable."] : []),
          ...(current.operatorEvidence ? [current.operatorEvidence] : []),
          ...(current.planTrace ? [current.planTrace] : []),
        ]),
        "Candidate text is navigation for this decision. Read promising candidates before moving to another search; do not copy candidate handles into workingMemory.",
        "The harness retains every source returned by read and commits it to the final source package.",
        "</MEMORY>",
      ].join("\n");
    },
  } satisfies MemoryObservation & { searchesRemaining(): number | undefined };
}
