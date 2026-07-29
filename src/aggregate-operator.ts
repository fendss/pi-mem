import type { StoreSearchHit } from "./store.js";
import type {
  EvidenceOperatorResult,
  EvidenceOperatorRow,
  NumericValueKind,
} from "./types.js";

export interface NumericFact {
  raw: string;
  value: number;
  unit: string;
  index: number;
  end: number;
  valueKind: NumericValueKind;
}

const CURRENCY: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
};

const NUMBER_WITH_UNIT = /\b(\d[\d,]*(?:\.\d+)?)\s+(comments?|followers?|bikes?|items?|products?|sales?|visits?|times?|restaurants?|books?|videos?|views?)\b/giu;
const CURRENCY_VALUE = /([$£€])\s*(\d[\d,]*(?:\.\d+)?)/gu;
const VALUE_CURRENCY = /\b(\d[\d,]*(?:\.\d+)?)\s*(dollars?|usd|pounds?|gbp|euros?|eur)\b/giu;

function numericValue(raw: string): number | undefined {
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : undefined;
}

function extractNumericMentions(content: string): Omit<NumericFact, "valueKind">[] {
  const mentions: Omit<NumericFact, "valueKind">[] = [];
  for (const match of content.matchAll(CURRENCY_VALUE)) {
    const value = numericValue(match[2]!);
    if (value === undefined) continue;
    const index = match.index ?? 0;
    const after = content.slice(index + match[0].length, index + match[0].length + 24);
    const sentenceStart = Math.max(
      content.lastIndexOf(".", index),
      content.lastIndexOf("!", index),
      content.lastIndexOf("?", index),
    );
    const before = content.slice(sentenceStart + 1, index);
    const quantities = [...before.matchAll(/\b(\d[\d,]*)\b/gu)];
    const quantity = quantities.length === 0
      ? undefined
      : numericValue(quantities.at(-1)![1]!);
    const perUnit = /^\s*(?:each|per\s+(?:item|unit|piece|plant|jar|product))\b/iu.test(after);
    mentions.push({
      raw: perUnit && quantity !== undefined
        ? `${match[0]} each × ${String(quantity)}`
        : match[0],
      value: perUnit && quantity !== undefined ? value * quantity : value,
      unit: CURRENCY[match[1]!] ?? match[1]!,
      index,
      end: index + match[0].length,
    });
  }
  for (const match of content.matchAll(VALUE_CURRENCY)) {
    const value = numericValue(match[1]!);
    if (value === undefined) continue;
    const rawUnit = match[2]!.toLowerCase();
    const unit = rawUnit.startsWith("dollar") || rawUnit === "usd"
      ? "USD"
      : rawUnit.startsWith("pound") || rawUnit === "gbp"
        ? "GBP"
        : "EUR";
    const index = match.index ?? 0;
    mentions.push({
      raw: match[0],
      value,
      unit,
      index,
      end: index + match[0].length,
    });
  }
  for (const match of content.matchAll(NUMBER_WITH_UNIT)) {
    const value = numericValue(match[1]!);
    if (value === undefined) continue;
    mentions.push({
      raw: match[0],
      value,
      unit: match[2]!.toLowerCase().replace(/s$/u, ""),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return mentions
    .sort((left, right) => left.index - right.index)
    .filter((mention, index, all) =>
      index === 0 ||
      mention.index !== all[index - 1]!.index ||
      mention.raw !== all[index - 1]!.raw
    );
}

function classifyValue(
  content: string,
  mention: Omit<NumericFact, "valueKind">,
): NumericValueKind {
  const context = content
    .slice(Math.max(0, mention.index - 80), mention.index + mention.raw.length + 80)
    .toLowerCase();
  if (/\b(?:hope|goal|aim|target|budget|plan(?:ning)? to|want to|expect(?:ed)? to|would like to)\b/u.test(context)) {
    return "target";
  }
  if (/\b(?:so far|to date|altogether|cumulative|overall total|total across|current total)\b/u.test(context)) {
    return "cumulative";
  }
  if (/\b(?:currently|right now|now have|current|personal best|record is|followers? (?:is|are|at))\b/u.test(context)) {
    return "snapshot";
  }
  return "increment";
}

export function extractNumericFacts(content: string): NumericFact[] {
  return extractNumericMentions(content).map((mention) => ({
    ...mention,
    valueKind: classifyValue(content, mention),
  }));
}

function rowKey(hit: StoreSearchHit, mention: NumericFact): string {
  return `${hit.record.sessionId}|${mention.unit}|${String(mention.value)}`;
}

export function buildAggregateOperatorResult(
  hits: readonly StoreSearchHit[],
): EvidenceOperatorResult {
  const rows: EvidenceOperatorRow[] = [];
  for (const hit of hits) {
    const extracted = extractNumericFacts(hit.record.content);
    const selectedIndexes = hit.operatorNumericFactIndexes === undefined
      ? undefined
      : new Set(hit.operatorNumericFactIndexes);
    for (const [factIndex, mention] of extracted.entries()) {
      if (selectedIndexes !== undefined && !selectedIndexes.has(factIndex)) continue;
      rows.push({
        slot: hit.query,
        quote: hit.record.content.slice(
          Math.max(0, mention.index - 90),
          Math.min(hit.record.content.length, mention.index + mention.raw.length + 90),
        ).replace(/\s+/gu, " ").trim(),
        memoryId: hit.record.memoryId,
        sessionId: hit.record.sessionId,
        turnIndex: hit.record.turnIndex,
        role: hit.record.role,
        value: mention.value,
        unit: mention.unit,
        valueKind: mention.valueKind,
        dedupeKey: rowKey(hit, mention),
        rawValue: mention.raw,
        ...(hit.record.timestamp === undefined ? {} : { eventTime: hit.record.timestamp.slice(0, 10) }),
      });
    }
  }
  rows.sort((left, right) => {
    const role = (left.role === "user" ? 0 : 1) - (right.role === "user" ? 0 : 1);
    if (role !== 0) return role;
    const time = (left.eventTime ?? "9999-99-99").localeCompare(right.eventTime ?? "9999-99-99");
    return time !== 0 ? time : left.memoryId.localeCompare(right.memoryId);
  });

  const directRows = rows.filter((row) => row.role === "user");
  const sourceRows = directRows.length > 0 ? directRows : rows;
  const unique = new Map<string, EvidenceOperatorRow>();
  for (const row of sourceRows) {
    if (row.dedupeKey !== undefined && !unique.has(row.dedupeKey)) {
      unique.set(row.dedupeKey, row);
    }
  }
  const additive = [...unique.values()].filter((row) => row.valueKind === "increment");
  const units = new Set(additive.map((row) => row.unit).filter(Boolean));
  const proposedTotal = additive.length > 1 && units.size === 1
    ? additive.reduce((total, row) => total + (row.value ?? 0), 0)
    : undefined;
  const cumulative = [...unique.values()]
    .filter((row) => row.valueKind === "cumulative" || row.valueKind === "snapshot")
    .sort((left, right) => (left.eventTime ?? "").localeCompare(right.eventTime ?? ""));
  const latest = cumulative.at(-1);

  return {
    version: "pimem-evidence-operators-v1",
    operator: "aggregate",
    rows: rows.slice(0, 40),
    coverage: {
      candidateCount: hits.length,
      distinctSessions: new Set(hits.map((hit) => hit.record.sessionId)).size,
      truncated: rows.length > 40,
    },
    derived: {
      ...(proposedTotal === undefined
        ? {}
        : {
            proposedTotal,
            unit: additive[0]?.unit,
            includedDedupeKeys: additive.map((row) => row.dedupeKey),
          }),
      ...(latest === undefined
        ? {}
        : {
            latestCumulativeOrSnapshot: latest.value,
            latestUnit: latest.unit,
            latestMemoryId: latest.memoryId,
          }),
      excludedTargetCount: [...unique.values()].filter((row) => row.valueKind === "target").length,
    },
  };
}
