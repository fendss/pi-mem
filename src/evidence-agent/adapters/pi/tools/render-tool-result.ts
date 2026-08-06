import type { MemoryRecord } from "../../../../memory/index.js";
import {
  temporalAnnotation,
  type EvidenceOperatorResult,
} from "../../../../retrieval/index.js";
import type { MemoryCandidate } from "../../../index.js";
import type { MemoryLedger } from "../../../model/memory-ledger.js";

function temporalSuffix(
  timestamp: string | undefined,
  questionDate: string | undefined,
): string {
  const annotation = temporalAnnotation(timestamp, questionDate);
  return annotation ? ` (${annotation})` : "";
}

export function renderEvidenceOperator(
  result: EvidenceOperatorResult | undefined,
  ledger: MemoryLedger,
): string {
  if (!result) return "";
  const heading = result.operator === "temporal"
    ? "Temporal evidence:"
    : "Numeric evidence:";
  const rows = result.rows.slice(0, 16).map((row) => {
    const temporal = row.eventTime === undefined ? "" : ` | event_time=${row.eventTime}`;
    const mentions = row.mentionedDates === undefined
      ? ""
      : ` | mentioned_dates=${row.mentionedDates.join(",")}`;
    const numeric = row.value === undefined
      ? ""
      : ` | value=${String(row.value)} ${row.unit ?? ""} | value_kind=${row.valueKind ?? "unknown"} | occurrence_ref=candidate:${String(ledger.candidateRef(row.memoryId))}`;
    const candidateRef = ledger.candidateRef(row.memoryId);
    return `- [candidate:${String(candidateRef ?? "unavailable")}] | slot=${JSON.stringify(row.slot)}${temporal}${mentions}${numeric} | ${row.quote}`;
  });
  const plan = result.temporalPlan === undefined
    ? []
    : [`temporal_plan=${JSON.stringify(result.temporalPlan)}`];
  const derivedForAgent = result.derived === undefined
    ? undefined
    : Object.fromEntries(Object.entries(result.derived).map(([key, value]) => {
        if (key === "latestMemoryId" && typeof value === "string") {
          return ["latestCandidateRef", ledger.candidateRef(value)];
        }
        if (key === "includedMemoryIds" && Array.isArray(value)) {
          return ["includedCandidateRefs", value.map((memoryId) =>
            typeof memoryId === "string" ? ledger.candidateRef(memoryId) : undefined
          ).filter((item) => item !== undefined)];
        }
        if (key === "includedDedupeKeys" && Array.isArray(value)) {
          return ["includedOccurrenceCount", value.length];
        }
        return [key, value];
      }));
  const derived = derivedForAgent === undefined
    ? []
    : [`derived=${JSON.stringify(derivedForAgent)}`];
  return [
    heading,
    ...plan,
    ...rows,
    ...derived,
    `coverage=${JSON.stringify(result.coverage)}`,
  ].join("\n");
}

export function renderCandidates(
  candidates: readonly MemoryCandidate[],
  ledger: MemoryLedger,
  questionDate?: string,
): string {
  if (candidates.length === 0) return "No memory candidates found.";
  const lines = candidates.map((candidate) => {
    const time = candidate.timestamp ? ` | session_time=${candidate.timestamp}` : "";
    const discovery = [...candidate.discoveries]
      .reverse()
      .find((item) => item.tool === "search" && item.query);
    const matched = discovery?.query === undefined
      ? ""
      : ` | matched_query=${JSON.stringify(discovery.query)} | rank=${String(discovery.rank ?? "unknown")}`;
    return `- [candidate:${String(ledger.candidateRef(candidate.memoryId))}]${time}${temporalSuffix(candidate.timestamp, questionDate)} | turn=${String(candidate.turnIndex)} | role=${candidate.role}${matched} | ${candidate.preview}`;
  });
  return [
    `candidate_refs=${JSON.stringify(candidates.map((candidate) => ledger.candidateRef(candidate.memoryId)))}`,
    ...lines,
  ].join("\n");
}

export function renderMemories(
  memories: readonly MemoryRecord[],
  ledger: MemoryLedger,
  questionDate?: string,
): string {
  return memories
    .map((memory) => {
      const time = memory.timestamp ? ` ${memory.timestamp}` : "";
      return `[candidate:${String(ledger.candidateRef(memory.memoryId))}; read:true]${time}${temporalSuffix(memory.timestamp, questionDate)} ${memory.role}\n${memory.content}`;
    })
    .join("\n\n");
}
