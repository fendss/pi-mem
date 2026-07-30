import type { StoreSearchHit } from "./store.js";
import { parseSourceTimestamp } from "./temporal.js";
import type {
  EvidenceOperatorResult,
  EvidenceOperatorRow,
  SearchRequest,
} from "./types.js";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export interface ResolvedTemporalTarget {
  expression: string;
  date: string;
  basis: "relative-to-question" | "explicit-in-question";
}

export interface TemporalQuestionPlan {
  questionDate?: string;
  targets: ResolvedTemporalTarget[];
}

export interface TemporalFact {
  expression: string;
  resolvedDate: string;
  basis: "explicit-in-memory" | "relative-to-memory";
  index: number;
  end: number;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addCalendarUnits(
  timestamp: number,
  amount: number,
  unit: "day" | "week" | "month" | "year",
): number {
  const date = new Date(startOfDay(timestamp));
  if (unit === "day") date.setUTCDate(date.getUTCDate() + amount);
  if (unit === "week") date.setUTCDate(date.getUTCDate() + amount * 7);
  if (unit === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  if (unit === "year") date.setUTCFullYear(date.getUTCFullYear() + amount);
  return date.getTime();
}

function cleanQuestion(question: string): string {
  return question
    .replace(
      /^\s*now is\s+\d{4}[/-]\d{2}[/-]\d{2}(?:\s*\([^)]*\))?(?:\s+\d{2}:\d{2})?\.?\s*(?:please answer the question:\s*)?/iu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function parseAmount(value: string): number | undefined {
  if (/^\d+$/u.test(value)) return Number(value);
  return NUMBER_WORDS[value.toLowerCase()];
}

export function resolveTemporalQuestion(
  question: string,
  questionDate?: string,
): TemporalQuestionPlan {
  const questionTimestamp = parseSourceTimestamp(questionDate);
  const plan: TemporalQuestionPlan = {
    ...(questionDate === undefined ? {} : { questionDate }),
    targets: [],
  };
  if (questionTimestamp === undefined) return plan;
  const cleaned = cleanQuestion(question);
  const seen = new Set<string>();
  const add = (target: ResolvedTemporalTarget): void => {
    const key = `${target.expression}\0${target.date}`;
    if (!seen.has(key)) {
      seen.add(key);
      plan.targets.push(target);
    }
  };

  const relativePattern = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+ago\b/giu;
  for (const match of cleaned.matchAll(relativePattern)) {
    const amount = parseAmount(match[1]!);
    if (amount === undefined) continue;
    add({
      expression: match[0],
      date: isoDate(
        addCalendarUnits(
          questionTimestamp,
          -amount,
          match[2]!.toLowerCase() as "day" | "week" | "month" | "year",
        ),
      ),
      basis: "relative-to-question",
    });
  }

  if (/\byesterday\b/iu.test(cleaned)) {
    add({
      expression: "yesterday",
      date: isoDate(addCalendarUnits(questionTimestamp, -1, "day")),
      basis: "relative-to-question",
    });
  }

  const weekdayPattern = /\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/giu;
  for (const match of cleaned.matchAll(weekdayPattern)) {
    const targetWeekday = WEEKDAYS[match[1]!.toLowerCase()];
    if (targetWeekday === undefined) continue;
    const questionWeekday = new Date(questionTimestamp).getUTCDay();
    const daysBack = ((questionWeekday - targetWeekday + 7) % 7) || 7;
    add({
      expression: match[0],
      date: isoDate(addCalendarUnits(questionTimestamp, -daysBack, "day")),
      basis: "relative-to-question",
    });
  }

  const monthPattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/giu;
  for (const match of cleaned.matchAll(monthPattern)) {
    const month = MONTHS[match[1]!.toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3] ?? new Date(questionTimestamp).getUTCFullYear());
    if (month === undefined) continue;
    const timestamp = Date.UTC(year, month, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
      continue;
    }
    add({
      expression: match[0],
      date: isoDate(timestamp),
      basis: "explicit-in-question",
    });
  }

  if (/\bvalentine(?:'s|s)?\s+day\b/iu.test(cleaned)) {
    const year = new Date(questionTimestamp).getUTCFullYear();
    add({
      expression: "Valentine's Day",
      date: `${String(year)}-02-14`,
      basis: "explicit-in-question",
    });
  }

  return plan;
}

export function temporalAuxiliaryRequest(
  request: SearchRequest,
  plan: TemporalQuestionPlan,
): SearchRequest | undefined {
  if (plan.targets.length !== 1) return undefined;
  const target = plan.targets[0]!;
  const targetPrefix = `${target.date}T`;
  if (
    request.after?.startsWith(targetPrefix) &&
    request.before?.startsWith(targetPrefix)
  ) {
    return undefined;
  }
  return {
    ...request,
    after: request.after ?? `${target.date}T00:00:00`,
    before: request.before ?? `${target.date}T23:59:59`,
    order: "chronological",
  };
}

function explicitDates(content: string, fallbackYear?: number): string[] {
  const dates = new Set<string>();
  const numeric = /\b(\d{4})[-/](\d{2})[-/](\d{2})\b/gu;
  for (const match of content.matchAll(numeric)) {
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isFinite(timestamp)) dates.add(isoDate(timestamp));
  }
  const monthPattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/giu;
  for (const match of content.matchAll(monthPattern)) {
    const month = MONTHS[match[1]!.toLowerCase()];
    const year = Number(match[3] ?? fallbackYear);
    const day = Number(match[2]);
    if (month === undefined || !Number.isFinite(year)) continue;
    const timestamp = Date.UTC(year, month, day);
    const date = new Date(timestamp);
    if (date.getUTCMonth() === month && date.getUTCDate() === day) dates.add(isoDate(timestamp));
  }
  return [...dates].sort();
}

/**
 * Extracts deterministic event-date facts from one immutable memory turn.
 * Relative expressions are anchored only to that turn's source timestamp;
 * no model inference is involved.
 */
export function extractTemporalFacts(
  content: string,
  sourceTimestamp?: string,
): TemporalFact[] {
  const sourceTime = parseSourceTimestamp(sourceTimestamp);
  const fallbackYear = sourceTime === undefined
    ? undefined
    : new Date(sourceTime).getUTCFullYear();
  const facts: TemporalFact[] = [];
  const seen = new Set<string>();
  const add = (fact: TemporalFact): void => {
    const key = `${fact.index}\0${fact.end}\0${fact.resolvedDate}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(fact);
    }
  };

  for (const match of content.matchAll(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/gu)) {
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(timestamp)) continue;
    const index = match.index ?? 0;
    add({
      expression: match[0],
      resolvedDate: isoDate(timestamp),
      basis: "explicit-in-memory",
      index,
      end: index + match[0].length,
    });
  }

  const monthPattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/giu;
  for (const match of content.matchAll(monthPattern)) {
    const month = MONTHS[match[1]!.toLowerCase()];
    const year = Number(match[3] ?? fallbackYear);
    const day = Number(match[2]);
    if (month === undefined || !Number.isFinite(year)) continue;
    const timestamp = Date.UTC(year, month, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) continue;
    const index = match.index ?? 0;
    add({
      expression: match[0],
      resolvedDate: isoDate(timestamp),
      basis: "explicit-in-memory",
      index,
      end: index + match[0].length,
    });
  }

  if (sourceTime !== undefined) {
    const relativePattern = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+ago\b/giu;
    for (const match of content.matchAll(relativePattern)) {
      const amount = parseAmount(match[1]!);
      if (amount === undefined) continue;
      const index = match.index ?? 0;
      add({
        expression: match[0],
        resolvedDate: isoDate(addCalendarUnits(
          sourceTime,
          -amount,
          match[2]!.toLowerCase() as "day" | "week" | "month" | "year",
        )),
        basis: "relative-to-memory",
        index,
        end: index + match[0].length,
      });
    }
    for (const match of content.matchAll(/\byesterday\b/giu)) {
      const index = match.index ?? 0;
      add({
        expression: match[0],
        resolvedDate: isoDate(addCalendarUnits(sourceTime, -1, "day")),
        basis: "relative-to-memory",
        index,
        end: index + match[0].length,
      });
    }
    for (const match of content.matchAll(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/giu)) {
      const targetWeekday = WEEKDAYS[match[1]!.toLowerCase()];
      if (targetWeekday === undefined) continue;
      const sourceWeekday = new Date(sourceTime).getUTCDay();
      const daysBack = ((sourceWeekday - targetWeekday + 7) % 7) || 7;
      const index = match.index ?? 0;
      add({
        expression: match[0],
        resolvedDate: isoDate(addCalendarUnits(sourceTime, -daysBack, "day")),
        basis: "relative-to-memory",
        index,
        end: index + match[0].length,
      });
    }
  }

  return facts.sort((left, right) =>
    left.index - right.index || left.resolvedDate.localeCompare(right.resolvedDate)
  );
}

export function buildTimelineOperatorResult(
  hits: readonly StoreSearchHit[],
  question: string,
  questionDate?: string,
  auxiliaryRequest?: SearchRequest,
): EvidenceOperatorResult {
  const plan = resolveTemporalQuestion(question, questionDate);
  const rows = hits.map((hit, sourceOrder) => {
    const sessionTimestamp = parseSourceTimestamp(hit.record.timestamp);
    const sessionDate = sessionTimestamp === undefined ? undefined : isoDate(sessionTimestamp);
    const mentions = explicitDates(
      hit.record.content,
      sessionTimestamp === undefined
        ? undefined
        : new Date(sessionTimestamp).getUTCFullYear(),
    );
    return {
      sourceOrder,
      row: {
      slot: hit.query,
      quote: hit.preview,
      memoryId: hit.record.memoryId,
      sessionId: hit.record.sessionId,
      turnIndex: hit.record.turnIndex,
      role: hit.record.role,
      ...(sessionDate === undefined ? {} : { eventTime: sessionDate }),
      ...(mentions.length === 0 ? {} : { mentionedDates: mentions }),
      } satisfies EvidenceOperatorRow,
    };
  }).sort((left, right) => {
    const time = (left.row.eventTime ?? "9999-99-99").localeCompare(right.row.eventTime ?? "9999-99-99");
    return time !== 0 ? time : left.sourceOrder - right.sourceOrder;
  }).map((item) => item.row);
  return {
    version: "pimem-evidence-operators-v1",
    operator: "temporal",
    rows,
    coverage: {
      candidateCount: hits.length,
      distinctSessions: new Set(hits.map((hit) => hit.record.sessionId)).size,
      truncated: false,
    },
    temporalPlan: {
      ...plan,
      auxiliaryWindowApplied: auxiliaryRequest !== undefined,
    },
  };
}
