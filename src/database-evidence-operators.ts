import type { DatabaseSync } from "node:sqlite";
import {
  EVIDENCE_FACT_EXTRACTOR_VERSION,
  EvidenceFactIndex,
  type EvidenceFactIndexStatus,
} from "./evidence-fact-index.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  SearchRequest,
} from "./types.js";
import { episodicPreview } from "./util.js";

interface MemoryRow {
  memory_id: string;
  scope_id: string;
  session_id: string;
  turn_index: number;
  role: MemoryRecord["role"];
  content: string;
  timestamp: string | null;
  content_hash: string;
  metadata_json: string;
}

interface TemporalFactRow extends MemoryRow {
  resolved_date: string;
}

interface NumericFactRow extends MemoryRow {
  fact_index: number;
  span_start: number;
  span_end: number;
  unit: string;
  value_kind: string;
}

export interface DatabaseOperatorSeed {
  record: MemoryRecord;
}

export interface DatabaseOperatorHit {
  record: MemoryRecord;
  query: string;
  retriever: "pimem-temporal-facts-db" | "pimem-numeric-facts-db";
  rank: number;
  score: number;
  preview: string;
  operatorNumericFactIndexes?: number[];
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  const record: MemoryRecord = {
    memoryId: row.memory_id,
    scopeId: row.scope_id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    role: row.role,
    content: row.content,
    contentHash: row.content_hash,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
  return row.timestamp === null ? record : { ...record, timestamp: row.timestamp };
}

function compareRecords(left: MemoryRecord, right: MemoryRecord): number {
  if (left.timestamp !== right.timestamp) {
    if (left.timestamp === undefined) return 1;
    if (right.timestamp === undefined) return -1;
    const time = left.timestamp.localeCompare(right.timestamp);
    if (time !== 0) return time;
  }
  const session = left.sessionId.localeCompare(right.sessionId);
  return session !== 0 ? session : left.turnIndex - right.turnIndex;
}

const OPERATOR_STOP_WORDS = new Set([
  "about", "after", "again", "all", "and", "before", "did", "does",
  "for", "from", "have", "how", "many", "much", "of", "the", "then",
  "total", "was", "were", "what", "when", "which", "with",
]);

function operatorTokens(queries: readonly string[]): string[] {
  const tokens = queries
    .join(" ")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) ?? [];
  return [...new Set(tokens.filter((token) =>
    token.length > 2 && !OPERATOR_STOP_WORDS.has(token)
  ))];
}

/**
 * Owns all deterministic, database-backed evidence indexing and expansion.
 * It never mutates raw memories; every table below is a versioned sidecar.
 */
export class DatabaseEvidenceOperators {
  private readonly db: DatabaseSync;
  private readonly factIndex: EvidenceFactIndex;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.factIndex = new EvidenceFactIndex(db);
  }

  /** Lazily materializes facts for one scope and is idempotent. */
  ensureScope(scopeId: string): EvidenceFactIndexStatus {
    return this.factIndex.ensureScope(scopeId);
  }

  expand(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly DatabaseOperatorSeed[],
  ): DatabaseOperatorHit[] {
    this.ensureScope(scopeId);
    return context.operator === "temporal_facts"
      ? this.expandTimeline(scopeId, request, context, seedHits)
      : this.expandAggregate(scopeId, request, context, seedHits);
  }

  private matchesRequestFilters(
    record: MemoryRecord,
    request: SearchRequest,
  ): boolean {
    if (request.sessionIds && !request.sessionIds.includes(record.sessionId)) {
      return false;
    }
    if (request.roles && !request.roles.includes(record.role)) return false;
    if (request.after && (!record.timestamp || record.timestamp < request.after)) {
      return false;
    }
    if (request.before && (!record.timestamp || record.timestamp > request.before)) {
      return false;
    }
    return true;
  }

  private hit(
    record: MemoryRecord,
    query: string,
    retriever: DatabaseOperatorHit["retriever"],
    rank: number,
  ): DatabaseOperatorHit {
    return {
      record,
      query,
      retriever,
      rank,
      score: 1 / (60 + rank),
      preview: episodicPreview(record.content),
    };
  }

  private expandTimeline(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly DatabaseOperatorSeed[],
  ): DatabaseOperatorHit[] {
    const rows = this.db.prepare(`
      SELECT m.memory_id, m.scope_id, m.session_id, m.turn_index, m.role,
             m.content, m.timestamp, m.content_hash, m.metadata_json,
             t.resolved_date
      FROM memory_temporal_facts AS t
      JOIN memories AS m ON m.memory_id = t.memory_id
      WHERE t.scope_id = ? AND t.extractor_version = ?
      ORDER BY t.resolved_date ASC, m.session_id ASC, m.turn_index ASC
    `).all(scopeId, EVIDENCE_FACT_EXTRACTOR_VERSION) as unknown as TemporalFactRow[];
    const targetDates = new Set(context.dates);
    const seedSessions = new Set(seedHits.map((hit) => hit.record.sessionId));
    const seedMemories = new Set(seedHits.map((hit) => hit.record.memoryId));
    const seedOrder = new Map(seedHits.map((hit, index) => [hit.record.memoryId, index]));
    const grouped = new Map<string, { record: MemoryRecord; dates: Set<string> }>();
    const {
      after: _ignoredAfter,
      before: _ignoredBefore,
      ...timelineFilters
    } = request;

    for (const row of rows) {
      const record = rowToRecord(row);
      // Resolved target dates, not model-supplied bounds, drive this expansion.
      if (!this.matchesRequestFilters(record, timelineFilters)) continue;
      const entry = grouped.get(record.memoryId) ?? {
        record,
        dates: new Set<string>(),
      };
      entry.dates.add(row.resolved_date);
      grouped.set(record.memoryId, entry);
    }

    const ranked = [...grouped.values()]
      .map((entry) => {
        const targetMatch = [...entry.dates].some((date) => targetDates.has(date));
        const seedMemory = seedMemories.has(entry.record.memoryId);
        const seedSession = seedSessions.has(entry.record.sessionId);
        return {
          ...entry,
          targetMatch,
          seedSession,
          seedOrder: seedOrder.get(entry.record.memoryId) ?? Number.MAX_SAFE_INTEGER,
          priority: targetMatch && seedMemory
            ? 0
            : targetMatch && seedSession
              ? 1
              : targetMatch
                ? 2
                : seedMemory
                  ? 3
                  : seedSession
                    ? 4
                    : 5,
        };
      })
      .filter((entry) => entry.targetMatch || entry.seedSession)
      .sort((left, right) => {
        const priority = left.priority - right.priority;
        if (priority !== 0) return priority;
        const relevance = left.seedOrder - right.seedOrder;
        return relevance !== 0 ? relevance : compareRecords(left.record, right.record);
      })
      .slice(0, context.maxCandidates);
    const query = targetDates.size === 0
      ? "database temporal facts"
      : `database temporal facts for dates ${[...targetDates].join(",")}`;
    return ranked.map((entry, index) =>
      this.hit(entry.record, query, "pimem-temporal-facts-db", index + 1)
    );
  }

  private expandAggregate(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly DatabaseOperatorSeed[],
  ): DatabaseOperatorHit[] {
    const rows = this.db.prepare(`
      SELECT
        m.memory_id, m.scope_id, m.session_id, m.turn_index, m.role,
        m.content, m.timestamp, m.content_hash, m.metadata_json,
        n.fact_index, n.span_start, n.span_end, n.unit, n.value_kind
      FROM memory_numeric_facts AS n
      JOIN memories AS m ON m.memory_id = n.memory_id
      WHERE n.scope_id = ? AND n.extractor_version = ?
      ORDER BY m.timestamp IS NULL ASC, m.timestamp ASC,
               m.session_id ASC, m.turn_index ASC, n.fact_index ASC
    `).all(scopeId, EVIDENCE_FACT_EXTRACTOR_VERSION) as unknown as NumericFactRow[];
    const seedSessions = new Set(seedHits.map((hit) => hit.record.sessionId));
    const seedMemories = new Set(seedHits.map((hit) => hit.record.memoryId));
    const tokens = operatorTokens(request.queries);
    const grouped = new Map<string, {
      record: MemoryRecord;
      factIndexes: number[];
      overlap: number;
      seedMemory: boolean;
      seedSession: boolean;
    }>();

    for (const row of rows) {
      const record = rowToRecord(row);
      if (!this.matchesRequestFilters(record, request)) continue;
      if (context.units.length > 0 && !context.units.includes(row.unit)) continue;
      if (
        context.valueKinds.length > 0 &&
        !context.valueKinds.includes(row.value_kind as (typeof context.valueKinds)[number])
      ) continue;
      const localContext = record.content
        .slice(
          Math.max(0, row.span_start - 140),
          Math.min(record.content.length, row.span_end + 140),
        )
        .normalize("NFKC")
        .toLowerCase();
      const overlap = tokens.filter((token) => localContext.includes(token)).length;
      const seedMemory = seedMemories.has(record.memoryId);
      const seedSession = seedSessions.has(record.sessionId);
      const explicitFactFilter = context.units.length > 0 ||
        context.valueKinds.length > 0;
      if (!seedMemory && !seedSession && overlap === 0 && !explicitFactFilter) {
        continue;
      }
      const entry = grouped.get(record.memoryId) ?? {
        record,
        factIndexes: [],
        overlap: 0,
        seedMemory,
        seedSession,
      };
      entry.factIndexes.push(row.fact_index);
      entry.overlap = Math.max(entry.overlap, overlap);
      grouped.set(record.memoryId, entry);
    }

    const ranked = [...grouped.values()]
      .map((entry) => ({
        ...entry,
        priority: entry.seedMemory
          ? 0
          : entry.seedSession && entry.overlap > 0
            ? 1
            : entry.overlap > 0
              ? 2
              : 3,
      }))
      .sort((left, right) => {
        const priority = left.priority - right.priority;
        if (priority !== 0) return priority;
        const overlap = right.overlap - left.overlap;
        if (overlap !== 0) return overlap;
        const role = (left.record.role === "user" ? 0 : 1) -
          (right.record.role === "user" ? 0 : 1);
        return role !== 0 ? role : compareRecords(left.record, right.record);
      })
      .slice(0, context.maxCandidates);

    return ranked.map((entry, index) => ({
      ...this.hit(
        entry.record,
        `database numeric facts for ${request.queries.join(" | ")}`,
        "pimem-numeric-facts-db",
        index + 1,
      ),
      operatorNumericFactIndexes: entry.factIndexes,
    }));
  }
}
