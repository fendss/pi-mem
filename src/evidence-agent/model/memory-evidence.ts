import type { MemoryRecord, MemoryRole } from "../../memory/index.js";
import { sha256 } from "../../util.js";

export const MAX_READ_RESULT_CHARS = 64 * 1024;
export const MAX_EVIDENCE_CHARS_PER_MEMORY = 8 * 1024;
export const MAX_SELECTED_EVIDENCE_CHARS = 256 * 1024;

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

  const headLength = Math.min(1_024, budget);
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

  const windowLength = Math.min(4_096, Math.max(512, remaining));
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
  ).join("\n\n[… source content omitted; re-read this candidate if another passage is needed …]\n\n");
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

export function projectMemoryEvidenceBatch(
  records: readonly MemoryRecord[],
  focusFor: (record: MemoryRecord) => readonly string[],
): MemoryEvidence[] {
  if (records.length === 0) return [];
  const perMemoryBudget = Math.min(
    MAX_EVIDENCE_CHARS_PER_MEMORY,
    Math.max(256, Math.floor(MAX_READ_RESULT_CHARS / records.length)),
  );
  return records.map((record) =>
    projectMemoryEvidence(record, focusFor(record), perMemoryBudget)
  );
}
