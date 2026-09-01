import type { MemoryRecord, MemoryRole } from "../../memory/index.js";
import {
  assertPassageMatchesRecord,
  type MemoryPassage,
} from "../../retrieval/index.js";
import { sha256 } from "../../util.js";

export const MAX_READ_RESULT_CHARS = 64 * 1024;
export const MAX_EVIDENCE_CHARS_PER_MEMORY = 8 * 1024;
export const MAX_INSPECTED_EVIDENCE_COUNT = 128;
export const MAX_INSPECTED_EVIDENCE_CHARS = 1024 * 1024;
/** Backward-compatible names for the automatically committed read-ledger bounds. */
export const MAX_SELECTED_EVIDENCE_COUNT = MAX_INSPECTED_EVIDENCE_COUNT;
export const MAX_SELECTED_EVIDENCE_CHARS = MAX_INSPECTED_EVIDENCE_CHARS;

export interface EvidenceExcerpt {
  /** UTF-16 offsets into the immutable source MemoryRecord content. */
  start: number;
  end: number;
  content: string;
}

/**
 * A bounded, byte-verifiable view of one immutable source memory.
 *
 * Evidence is intentionally distinct from MemoryRecord: its content may be a
 * focused projection, while sourceContentHash continues to bind it to the
 * complete source held by the MemoryStore.
 */
export interface MemoryEvidence {
  memoryId: string;
  scopeId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  timestamp?: string;
  content: string;
  contentHash: string;
  sourceContentHash: string;
  sourceContentLength: number;
  truncated: boolean;
  excerpts: EvidenceExcerpt[];
  metadata: Record<string, unknown>;
}

const STOP_WORDS = new Set([
  "about", "after", "again", "all", "also", "and", "before", "between",
  "did", "does", "for", "from", "have", "how", "into", "last", "of",
  "the", "then", "through", "to", "turn", "was", "were", "what", "when",
  "where", "which", "with",
]);

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function focusTerms(focus: readonly string[]): string[] {
  return [...new Set(
    focus
      .join(" ")
      .normalize("NFKC")
      .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) ?? [],
  )].filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function mergeSpans(
  spans: readonly { start: number; end: number }[],
): Array<{ start: number; end: number }> {
  const ordered = [...spans].sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of ordered) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function focusedSpans(
  content: string,
  focus: readonly string[],
  budget: number,
): Array<{ start: number; end: number }> {
  if (content.length <= budget) return [{ start: 0, end: content.length }];

  // Preserve both source identity/context at the head and query-focused
  // evidence even when a very large batch gives this source <256 characters.
  const headLength = Math.min(
    1_024,
    Math.max(1, Math.floor(budget / 4)),
  );
  const spans: Array<{ start: number; end: number }> = [
    { start: 0, end: headLength },
  ];
  let remaining = budget - headLength;
  if (remaining <= 0) return spans;

  // ASCII-only folding preserves UTF-16 offsets into the immutable source.
  const normalized = asciiLower(content);
  const terms = focusTerms(focus);
  const positions: Array<{ position: number; weight: number }> = [];
  for (const rawTerm of terms) {
    const term = asciiLower(rawTerm);
    let cursor = 0;
    let matches = 0;
    while (cursor < normalized.length && matches < 12) {
      const position = normalized.indexOf(term, cursor);
      if (position < 0) break;
      positions.push({ position, weight: Math.min(term.length, 24) });
      cursor = position + Math.max(1, term.length);
      matches += 1;
    }
  }

  const windowLength = Math.min(4_096, Math.max(1, remaining));
  const windows = new Map<string, { start: number; end: number; score: number }>();
  for (const match of positions) {
    const start = Math.max(
      0,
      Math.min(content.length - windowLength, match.position - Math.floor(windowLength / 3)),
    );
    const end = Math.min(content.length, start + windowLength);
    const key = `${String(start)}:${String(end)}`;
    const existing = windows.get(key);
    windows.set(key, {
      start,
      end,
      score: (existing?.score ?? 0) + match.weight,
    });
  }

  const ranked = [...windows.values()].sort((left, right) =>
    right.score - left.score || left.start - right.start
  );
  for (const window of ranked) {
    if (remaining <= 0) break;
    const length = Math.min(window.end - window.start, remaining);
    if (length <= 0) continue;
    spans.push({ start: window.start, end: window.start + length });
    remaining -= length;
  }

  if (spans.length === 1 && remaining > 0) {
    const length = Math.min(remaining, content.length - headLength);
    spans.push({ start: content.length - length, end: content.length });
  }

  return mergeSpans(spans);
}

export function renderEvidenceExcerpts(options: {
  sourceContentLength: number;
  excerpts: readonly EvidenceExcerpt[];
}): string {
  if (
    options.excerpts.length === 1 && options.excerpts[0]!.start === 0 &&
    options.excerpts[0]!.end === options.sourceContentLength
  ) {
    return options.excerpts[0]!.content;
  }
  return options.excerpts.map((excerpt) =>
    `[source chars ${String(excerpt.start)}-${String(excerpt.end)} of ${String(options.sourceContentLength)}]\n${excerpt.content}`
  ).join("\n\n[… source content omitted; read this candidate again if another passage is needed …]\n\n");
}

function mergeEvidenceExcerpts(
  memoryId: string,
  sourceContentLength: number,
  excerpts: readonly EvidenceExcerpt[],
): EvidenceExcerpt[] {
  const ordered = excerpts.map((excerpt) => {
    if (
      !Number.isSafeInteger(excerpt.start) ||
      !Number.isSafeInteger(excerpt.end) ||
      excerpt.start < 0 ||
      excerpt.end < excerpt.start ||
      excerpt.end > sourceContentLength ||
      excerpt.content.length !== excerpt.end - excerpt.start
    ) {
      throw new Error(`Invalid exact evidence excerpt for ${memoryId}`);
    }
    return { ...excerpt };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: EvidenceExcerpt[] = [];
  for (const excerpt of ordered) {
    const previous = merged.at(-1);
    if (previous === undefined || excerpt.start > previous.end) {
      merged.push(excerpt);
      continue;
    }

    const overlapEnd = Math.min(previous.end, excerpt.end);
    const overlapLength = Math.max(0, overlapEnd - excerpt.start);
    if (overlapLength > 0) {
      const previousOffset = excerpt.start - previous.start;
      const previousOverlap = previous.content.slice(
        previousOffset,
        previousOffset + overlapLength,
      );
      const incomingOverlap = excerpt.content.slice(0, overlapLength);
      if (previousOverlap !== incomingOverlap) {
        throw new Error(
          `Conflicting exact evidence projections for immutable memory ${memoryId}`,
        );
      }
    }
    if (excerpt.end > previous.end) {
      previous.content += excerpt.content.slice(previous.end - excerpt.start);
      previous.end = excerpt.end;
    }
  }
  return merged;
}

/**
 * Accumulates independently inspected exact projections of one immutable source.
 * Re-inspecting a long memory may expose a different passage; the evidence ledger
 * must retain both passages instead of replacing the first with the second.
 */
export function mergeMemoryEvidence(
  existing: MemoryEvidence,
  incoming: MemoryEvidence,
): MemoryEvidence {
  if (
    existing.memoryId !== incoming.memoryId ||
    existing.scopeId !== incoming.scopeId ||
    existing.sessionId !== incoming.sessionId ||
    existing.turnIndex !== incoming.turnIndex ||
    existing.role !== incoming.role ||
    existing.timestamp !== incoming.timestamp ||
    existing.sourceContentHash !== incoming.sourceContentHash ||
    existing.sourceContentLength !== incoming.sourceContentLength
  ) {
    throw new Error(
      `Conflicting immutable source identity while merging evidence for ${existing.memoryId}`,
    );
  }
  const excerpts = mergeEvidenceExcerpts(
    existing.memoryId,
    existing.sourceContentLength,
    [...existing.excerpts, ...incoming.excerpts],
  );
  const content = renderEvidenceExcerpts({
    sourceContentLength: existing.sourceContentLength,
    excerpts,
  });
  return {
    ...existing,
    content,
    contentHash: sha256(content),
    truncated: excerpts.length !== 1 ||
      excerpts[0]!.start !== 0 ||
      excerpts[0]!.end !== existing.sourceContentLength,
    excerpts,
    metadata: cloneMetadata(existing.metadata),
  };
}

function projectMemoryEvidenceWithinBudget(
  record: MemoryRecord,
  focus: readonly string[],
  budget: number,
): MemoryEvidence {
  const excerpts = focusedSpans(record.content, focus, budget).map((span) => ({
    ...span,
    content: record.content.slice(span.start, span.end),
  }));
  const content = renderEvidenceExcerpts({
    sourceContentLength: record.content.length,
    excerpts,
  });
  return {
    memoryId: record.memoryId,
    scopeId: record.scopeId,
    sessionId: record.sessionId,
    turnIndex: record.turnIndex,
    role: record.role,
    ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
    content,
    contentHash: sha256(content),
    sourceContentHash: record.contentHash,
    sourceContentLength: record.content.length,
    truncated: excerpts.length !== 1 || excerpts[0]!.end !== record.content.length,
    excerpts,
    metadata: cloneMetadata(record.metadata),
  };
}

export function projectMemoryEvidence(
  record: MemoryRecord,
  focus: readonly string[],
  maximumChars: number,
): MemoryEvidence {
  const budget = Math.max(
    256,
    Math.min(MAX_EVIDENCE_CHARS_PER_MEMORY, Math.floor(maximumChars)),
  );
  return projectMemoryEvidenceWithinBudget(record, focus, budget);
}

/** Projects exactly the passage the Agent selected, bound to its parent hash. */
export function projectPassageEvidence(
  record: MemoryRecord,
  passage: MemoryPassage,
): MemoryEvidence {
  assertPassageMatchesRecord(passage, record);
  const excerpts = [{
    start: passage.start,
    end: passage.end,
    content: passage.content,
  }];
  const content = renderEvidenceExcerpts({
    sourceContentLength: record.content.length,
    excerpts,
  });
  return {
    memoryId: record.memoryId,
    scopeId: record.scopeId,
    sessionId: record.sessionId,
    turnIndex: record.turnIndex,
    role: record.role,
    ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
    content,
    contentHash: sha256(content),
    sourceContentHash: record.contentHash,
    sourceContentLength: record.content.length,
    truncated: passage.start !== 0 || passage.end !== record.content.length,
    excerpts,
    metadata: cloneMetadata(record.metadata),
  };
}

export function projectMemoryEvidenceBatch(
  records: readonly MemoryRecord[],
  focusFor: (record: MemoryRecord) => readonly string[],
): MemoryEvidence[] {
  if (records.length === 0) return [];
  if (records.length > MAX_READ_RESULT_CHARS) {
    throw new Error(
      `Read batch contains ${String(records.length)} memories, which cannot ` +
        `fit at least one exact source character per memory within the ` +
        `${String(MAX_READ_RESULT_CHARS)} character read budget`,
    );
  }
  const perMemoryBudget = Math.min(
    MAX_EVIDENCE_CHARS_PER_MEMORY,
    Math.floor(MAX_READ_RESULT_CHARS / records.length),
  );
  return records.map((record) =>
    projectMemoryEvidenceWithinBudget(record, focusFor(record), perMemoryBudget)
  );
}
