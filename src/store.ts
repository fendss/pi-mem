import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DatabaseEvidenceOperators } from "./database-evidence-operators.js";
import type { EvidenceFactIndexStatus } from "./evidence-fact-index.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  SearchRequest,
} from "./types.js";
import { finalizeSearchHits } from "./search-results.js";
import { episodicPreview, safePathSegment, sha256, stableMemoryId } from "./util.js";

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

interface SearchRow extends MemoryRow {
  rank: number;
}

interface EmbeddingRow extends MemoryRow {
  vector: Uint8Array;
}

interface ExistingEmbeddingRow {
  model: string;
  dimensions: number;
  content_hash: string;
  vector: Uint8Array;
}

interface VectorGenerationRow {
  generation_id: string;
  collection_name: string;
  profile_id: string;
  model: string;
  dimensions: number;
  state: VectorIndexGenerationState;
  source_fingerprint: string | null;
  expected_vector_count: number;
  high_water_sequence: number;
  last_error: string | null;
}

interface VectorOutboxCountRow {
  synced: number;
  pending: number;
  inflight: number;
}

interface VectorSyncRow {
  sequence_id: number;
  generation_id: string;
  scope_id: string;
  memory_id: string;
  session_id: string;
  role: MemoryRecord["role"];
  timestamp: string | null;
  profile_id: string;
  content_hash: string;
  attempts: number;
  vector: Uint8Array;
  dimensions: number;
}

export interface MemoryStoreOptions {
  readOnly?: boolean;
}

export interface EmbeddingProfile {
  profileId: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingIndexStatus {
  scopeId: string;
  profileId: string;
  total: number;
  indexed: number;
  missing: number;
}

export interface StoredEmbeddingRecord {
  record: MemoryRecord;
  vector: Float32Array;
}

export interface StoreEmbeddingBatchResult {
  inserted: number;
  unchanged: number;
}

export type VectorIndexGenerationState =
  | "ingesting"
  | "draining"
  | "verifying"
  | "ready"
  | "failed";

export interface VectorIndexGenerationConfig {
  generationId: string;
  collectionName: string;
  profile: EmbeddingProfile;
}

export interface VectorIndexGenerationStatus extends VectorIndexGenerationConfig {
  state: VectorIndexGenerationState;
  sourceFingerprint?: string;
  expectedVectorCount: number;
  syncedVectorCount: number;
  pendingVectorCount: number;
  inflightVectorCount: number;
  highWaterSequence: number;
  lastError?: string;
}

export interface VectorSyncClaim {
  sequenceId: number;
  generationId: string;
  scopeId: string;
  memoryId: string;
  sessionId: string;
  role: MemoryRecord["role"];
  timestamp?: string;
  profileId: string;
  contentHash: string;
  vector: Float32Array;
  attempts: number;
}

export interface AppendMemoryMessage {
  role: MemoryRecord["role"];
  content: string;
  timestamp?: string;
}

export interface AppendMemoryRequest {
  requestId: string;
  requestHash: string;
  scopeId: string;
  sourceSessionId: string;
  messages: readonly AppendMemoryMessage[];
}

export interface AppendMemoryResult {
  status: "pending" | "complete";
  records: MemoryRecord[];
}

interface AppendRequestRow {
  request_hash: string;
  scope_id: string;
  source_session_id: string;
  session_id: string;
  start_turn_index: number;
  message_count: number;
  complete: number;
}

export interface StoreSearchHit {
  record: MemoryRecord;
  query: string;
  retriever:
    | "fts5"
    | "pimem-hybrid"
    | "pimem-timeline-db"
    | "pimem-aggregate-db";
  rank: number;
  score: number;
  preview: string;
  operatorNumericFactIndexes?: number[];
}

export interface ScopeExport {
  scopeId: string;
  path: string;
  memoryCount: number;
}

export type ScopeIngestStatus = "inserted" | "unchanged";

function rowToRecord(row: MemoryRow): MemoryRecord {
  const base: MemoryRecord = {
    memoryId: row.memory_id,
    scopeId: row.scope_id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    role: row.role,
    content: row.content,
    contentHash: row.content_hash,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
  return row.timestamp ? { ...base, timestamp: row.timestamp } : base;
}

function ftsQuery(text: string): string {
  const tokens =
    text
      .normalize("NFKC")
      .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu)
      ?.map((token) => token.replaceAll('"', '""'))
      .filter((token) => token.length > 1)
      .slice(0, 24) ?? [];
  return [...new Set(tokens)].map((token) => `"${token}"`).join(" OR ");
}

function compareRecords(a: MemoryRecord, b: MemoryRecord): number {
  if (a.timestamp !== b.timestamp) {
    if (a.timestamp === undefined) return 1;
    if (b.timestamp === undefined) return -1;
    const time = a.timestamp.localeCompare(b.timestamp);
    if (time !== 0) return time;
  }
  const session = a.sessionId.localeCompare(b.sessionId);
  return session !== 0 ? session : a.turnIndex - b.turnIndex;
}

function recordFingerprint(record: MemoryRecord): string {
  return JSON.stringify([
    record.memoryId,
    record.scopeId,
    record.sessionId,
    record.turnIndex,
    record.role,
    record.content,
    record.timestamp ?? null,
    record.contentHash,
    record.metadata,
  ]);
}

function isExistingTargetError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

function requiredIndexIdentity(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
  if (value.length > 512) throw new Error(`${label} exceeds 512 characters`);
  return value;
}

function boundedIndexError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function validateEmbeddingProfile(profile: EmbeddingProfile): void {
  if (!profile.profileId.trim()) throw new Error("Embedding profile ID must not be empty");
  if (!profile.model.trim()) throw new Error("Embedding model must not be empty");
  if (!Number.isSafeInteger(profile.dimensions) || profile.dimensions <= 0) {
    throw new Error("Embedding dimensions must be a positive integer");
  }
}

function encodeVector(vector: readonly number[], dimensions: number): Buffer {
  if (vector.length !== dimensions) {
    throw new Error(`Embedding vector must have ${dimensions} dimensions`);
  }
  const encoded = Buffer.allocUnsafe(dimensions * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains a non-finite value");
    }
    encoded.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  return encoded;
}

function decodeVector(value: Uint8Array, dimensions: number): Float32Array {
  const expectedBytes = dimensions * Float32Array.BYTES_PER_ELEMENT;
  if (value.byteLength !== expectedBytes) {
    throw new Error(
      `Stored embedding vector has ${value.byteLength} bytes, expected ${expectedBytes}`,
    );
  }
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const decoded = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    const item = view.getFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      true,
    );
    if (!Number.isFinite(item)) {
      throw new Error("Stored embedding vector contains a non-finite value");
    }
    decoded[index] = item;
  }
  return decoded;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export class MemoryStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private readonly evidenceOperators: DatabaseEvidenceOperators;
  private readonly validatedEmbeddingProfiles = new Map<string, string>();
  private readonly completeEmbeddingStatuses = new Map<
    string,
    EmbeddingIndexStatus
  >();

  constructor(databasePath: string, options: MemoryStoreOptions = {}) {
    this.databasePath = databasePath;
    const readOnly = options.readOnly ?? false;
    this.db = new DatabaseSync(databasePath, { readOnly });
    if (readOnly) {
      this.db.exec("PRAGMA busy_timeout = 30000");
      this.db.exec(`
        PRAGMA query_only = ON;
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 4294967296;
        PRAGMA cache_size = -65536;
      `);
      this.evidenceOperators = new DatabaseEvidenceOperators(this.db, true);
      return;
    }
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL UNIQUE,
        scope_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memories_scope_session_turn
        ON memories(scope_id, session_id, turn_index);
      CREATE INDEX IF NOT EXISTS memories_scope_timestamp
        ON memories(scope_id, timestamp);
      CREATE INDEX IF NOT EXISTS memories_scope_memory
        ON memories(scope_id, memory_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        scope_id UNINDEXED,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (memory_id, profile_id),
        FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
      );
      CREATE INDEX IF NOT EXISTS memory_embeddings_profile
        ON memory_embeddings(profile_id, memory_id);
      CREATE TABLE IF NOT EXISTS vector_index_generations (
        generation_id TEXT PRIMARY KEY,
        collection_name TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('ingesting', 'draining', 'verifying', 'ready', 'failed')
        ),
        source_fingerprint TEXT,
        expected_vector_count INTEGER NOT NULL DEFAULT 0,
        high_water_sequence INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vector_sync_outbox (
        sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'inflight', 'synced')),
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_until_ms INTEGER,
        last_error TEXT,
        UNIQUE (generation_id, memory_id, profile_id),
        FOREIGN KEY (generation_id)
          REFERENCES vector_index_generations(generation_id),
        FOREIGN KEY (memory_id, profile_id)
          REFERENCES memory_embeddings(memory_id, profile_id)
      );
      CREATE INDEX IF NOT EXISTS vector_sync_outbox_claim
        ON vector_sync_outbox(generation_id, state, sequence_id);
      CREATE INDEX IF NOT EXISTS vector_sync_outbox_scope
        ON vector_sync_outbox(generation_id, scope_id, state);
      CREATE TABLE IF NOT EXISTS memory_append_sessions (
        scope_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        next_turn_index INTEGER NOT NULL,
        PRIMARY KEY (scope_id, source_session_id),
        UNIQUE (scope_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS memory_append_requests (
        request_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        start_turn_index INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS memory_append_requests_scope
        ON memory_append_requests(scope_id, request_id);
    `);
    this.evidenceOperators = new DatabaseEvidenceOperators(this.db, false);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Inserts one immutable source scope.
   *
   * Re-ingesting byte-identical records is a no-op. A caller must use a new
   * scope/version when any source record changes; existing raw memory is never
   * silently deleted or overwritten.
   */
  ingestScope(
    scopeId: string,
    records: MemoryRecord[],
  ): ScopeIngestStatus {
    if (records.length === 0) {
      throw new Error(`Cannot ingest empty memory scope: ${scopeId}`);
    }
    if (records.some((record) => record.scopeId !== scopeId)) {
      throw new Error(`Every memory record must belong to scope ${scopeId}`);
    }
    if (
      new Set(records.map((record) => record.memoryId)).size !== records.length
    ) {
      throw new Error(`Duplicate memory ID in scope ${scopeId}`);
    }

    const existing = this.listScopeRecords(scopeId);
    if (existing.length > 0) {
      const current = existing.map(recordFingerprint).sort();
      const incoming = records.map(recordFingerprint).sort();
      if (
        current.length === incoming.length &&
        current.every((fingerprint, index) => fingerprint === incoming[index])
      ) {
        return "unchanged";
      }
      throw new Error(
        `Immutable memory scope already exists with different content: ${scopeId}`,
      );
    }

    const insertRecord = this.db.prepare(`
      INSERT INTO memories (
        memory_id, scope_id, session_id, turn_index, role, content,
        timestamp, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO memory_fts(memory_id, scope_id, content)
      VALUES (?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        insertRecord.run(
          record.memoryId,
          record.scopeId,
          record.sessionId,
          record.turnIndex,
          record.role,
          record.content,
          record.timestamp ?? null,
          record.contentHash,
          JSON.stringify(record.metadata),
        );
        insertFts.run(
          record.memoryId,
          record.scopeId,
          `${record.role}: ${record.content}`,
        );
      }
      this.db.exec("COMMIT");
      return "inserted";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Appends one immutable, idempotent request chunk to an online memory scope.
   * The mutable request/session tables are bookkeeping sidecars only; inserted
   * source memories retain the same immutable raw-record contract as ingestScope.
   */
  appendMemoryRequest(request: AppendMemoryRequest): AppendMemoryResult {
    if (request.messages.length === 0) {
      throw new Error("Append request must contain at least one message");
    }
    const existing = this.db.prepare(`
      SELECT request_hash, scope_id, source_session_id, session_id,
             start_turn_index, message_count, complete
      FROM memory_append_requests
      WHERE request_id = ?
    `).get(request.requestId) as unknown as AppendRequestRow | undefined;
    if (existing) {
      if (
        existing.request_hash !== request.requestHash ||
        existing.scope_id !== request.scopeId ||
        existing.source_session_id !== request.sourceSessionId ||
        existing.message_count !== request.messages.length
      ) {
        throw new Error(`Append request ID conflict: ${request.requestId}`);
      }
      return {
        status: existing.complete === 1 ? "complete" : "pending",
        records: this.recordsInTurnRange(
          request.scopeId,
          existing.session_id,
          existing.start_turn_index,
          existing.message_count,
        ),
      };
    }

    const sessionId = `s-${sha256(
      `${request.scopeId}\0${request.sourceSessionId}`,
    ).slice(0, 24)}`;
    const getSession = this.db.prepare(`
      SELECT session_id, next_turn_index
      FROM memory_append_sessions
      WHERE scope_id = ? AND source_session_id = ?
    `);
    const insertSession = this.db.prepare(`
      INSERT INTO memory_append_sessions (
        scope_id, source_session_id, session_id, next_turn_index
      ) VALUES (?, ?, ?, 0)
    `);
    const updateSession = this.db.prepare(`
      UPDATE memory_append_sessions
      SET next_turn_index = ?
      WHERE scope_id = ? AND source_session_id = ?
    `);
    const insertRequest = this.db.prepare(`
      INSERT INTO memory_append_requests (
        request_id, request_hash, scope_id, source_session_id, session_id,
        start_turn_index, message_count, complete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertRecord = this.db.prepare(`
      INSERT INTO memories (
        memory_id, scope_id, session_id, turn_index, role, content,
        timestamp, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO memory_fts(memory_id, scope_id, content)
      VALUES (?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      let session = getSession.get(
        request.scopeId,
        request.sourceSessionId,
      ) as unknown as { session_id: string; next_turn_index: number } | undefined;
      if (!session) {
        insertSession.run(request.scopeId, request.sourceSessionId, sessionId);
        session = { session_id: sessionId, next_turn_index: 0 };
      }
      if (session.session_id !== sessionId) {
        throw new Error(`Append session identity conflict: ${request.sourceSessionId}`);
      }
      const startTurnIndex = session.next_turn_index;
      const records = request.messages.map((message, messageIndex) => {
        const turnIndex = startTurnIndex + messageIndex;
        const record: MemoryRecord = {
          memoryId: stableMemoryId(request.scopeId, sessionId, turnIndex),
          scopeId: request.scopeId,
          sessionId,
          turnIndex,
          role: message.role,
          content: message.content,
          contentHash: sha256(message.content),
          metadata: {
            session: { sourceSessionId: request.sourceSessionId },
            turn: { sourceMessageIndex: messageIndex },
          },
          ...(message.timestamp === undefined
            ? {}
            : { timestamp: message.timestamp }),
        };
        return record;
      });
      for (const record of records) {
        insertRecord.run(
          record.memoryId,
          record.scopeId,
          record.sessionId,
          record.turnIndex,
          record.role,
          record.content,
          record.timestamp ?? null,
          record.contentHash,
          JSON.stringify(record.metadata),
        );
        insertFts.run(
          record.memoryId,
          record.scopeId,
          `${record.role}: ${record.content}`,
        );
      }
      insertRequest.run(
        request.requestId,
        request.requestHash,
        request.scopeId,
        request.sourceSessionId,
        sessionId,
        startTurnIndex,
        records.length,
      );
      updateSession.run(
        startTurnIndex + records.length,
        request.scopeId,
        request.sourceSessionId,
      );
      this.db.exec("COMMIT");
      this.completeEmbeddingStatuses.clear();
      return { status: "pending", records };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hasPendingAppendRequests(scopeId: string): boolean {
    return this.db.prepare(`
      SELECT 1 FROM memory_append_requests
      WHERE scope_id = ? AND complete = 0
      LIMIT 1
    `).get(scopeId) !== undefined;
  }

  markAppendRequestComplete(requestId: string, requestHash: string): void {
    const result = this.db.prepare(`
      UPDATE memory_append_requests
      SET complete = 1
      WHERE request_id = ? AND request_hash = ?
    `).run(requestId, requestHash);
    if (result.changes !== 1) {
      throw new Error(`Cannot complete unknown append request: ${requestId}`);
    }
  }

  private recordsInTurnRange(
    scopeId: string,
    sessionId: string,
    startTurnIndex: number,
    count: number,
  ): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT memory_id, scope_id, session_id, turn_index, role, content,
             timestamp, content_hash, metadata_json
      FROM memories
      WHERE scope_id = ? AND session_id = ?
        AND turn_index >= ? AND turn_index < ?
      ORDER BY turn_index ASC
    `).all(
      scopeId,
      sessionId,
      startTurnIndex,
      startTurnIndex + count,
    ) as unknown as MemoryRow[];
    if (rows.length !== count) {
      throw new Error(`Append request records are incomplete in scope ${scopeId}`);
    }
    return rows.map(rowToRecord);
  }

  /** Builds or validates the deterministic sidecar index for one scope. */
  ensureEvidenceFactIndex(scopeId: string): EvidenceFactIndexStatus {
    return this.evidenceOperators.ensureScope(scopeId);
  }

  /** Expands hybrid/FTS seeds through the versioned database fact index. */
  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
  ): StoreSearchHit[] {
    return this.evidenceOperators.expand(scopeId, request, context, seedHits);
  }

  searchLexical(scopeId: string, request: SearchRequest): StoreSearchHit[] {
    return this.search(scopeId, request);
  }

  search(scopeId: string, request: SearchRequest): StoreSearchHit[] {
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const fetchLimit =
      request.maxPerSession === undefined
        ? limit
        : Math.min(100, Math.max(limit, limit * 4));
    const merged = new Map<string, StoreSearchHit>();
    const queryCoverageHits: StoreSearchHit[] = [];

    for (const query of request.queries) {
      const match = ftsQuery(query);
      if (!match) continue;

      const where: string[] = [
        "memory_fts MATCH ?",
        "memory_fts.scope_id = ?",
      ];
      const params: Array<string | number> = [match, scopeId];

      if (request.sessionIds && request.sessionIds.length > 0) {
        where.push(
          `m.session_id IN (${request.sessionIds.map(() => "?").join(", ")})`,
        );
        params.push(...request.sessionIds);
      }
      if (request.roles && request.roles.length > 0) {
        where.push(`m.role IN (${request.roles.map(() => "?").join(", ")})`);
        params.push(...request.roles);
      }
      if (request.after) {
        where.push("m.timestamp >= ?");
        params.push(request.after);
      }
      if (request.before) {
        where.push("m.timestamp <= ?");
        params.push(request.before);
      }
      params.push(fetchLimit);

      const statement = this.db.prepare(`
        SELECT
          m.memory_id, m.scope_id, m.session_id, m.turn_index, m.role,
          m.content, m.timestamp, m.content_hash, m.metadata_json,
          bm25(memory_fts, 1.0) AS rank
        FROM memory_fts
        JOIN memories AS m ON m.memory_id = memory_fts.memory_id
        WHERE ${where.join(" AND ")}
        ORDER BY rank ASC
        LIMIT ?
      `);
      const rows = statement.all(...params) as unknown as SearchRow[];
      rows.forEach((row, index) => {
        const hit: StoreSearchHit = {
          record: rowToRecord(row),
          query,
          retriever: "fts5",
          rank: index + 1,
          score: -row.rank,
          preview: episodicPreview(row.content),
        };
        if (index === 0) queryCoverageHits.push(hit);
        const existing = merged.get(hit.record.memoryId);
        if (!existing || hit.score > existing.score) {
          merged.set(hit.record.memoryId, hit);
        }
      });
    }

    const ordered = [
      ...(request.queries.length > 1 ? queryCoverageHits : []),
      ...[...merged.values()].sort((a, b) => b.score - a.score),
    ];
    const unique = new Map<string, StoreSearchHit>();
    for (const hit of ordered) {
      if (!unique.has(hit.record.memoryId)) unique.set(hit.record.memoryId, hit);
    }
    return finalizeSearchHits([...unique.values()], request, limit);
  }

  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore = 0,
    contextAfter = 0,
  ): MemoryRecord[] {
    const before = Math.min(Math.max(contextBefore, 0), 10);
    const after = Math.min(Math.max(contextAfter, 0), 10);
    const selected = new Map<string, MemoryRecord>();
    const getOne = this.db.prepare(`
      SELECT memory_id, scope_id, session_id, turn_index, role, content,
             timestamp, content_hash, metadata_json
      FROM memories
      WHERE scope_id = ? AND memory_id = ?
    `);
    const getContext = this.db.prepare(`
      SELECT memory_id, scope_id, session_id, turn_index, role, content,
             timestamp, content_hash, metadata_json
      FROM memories
      WHERE scope_id = ? AND session_id = ?
        AND turn_index BETWEEN ? AND ?
      ORDER BY turn_index ASC
    `);

    for (const memoryId of [...new Set(memoryIds)]) {
      const row = getOne.get(scopeId, memoryId) as unknown as
        | MemoryRow
        | undefined;
      if (!row) {
        throw new Error(`Memory not found in scope: ${memoryId}`);
      }
      const contextRows = getContext.all(
        scopeId,
        row.session_id,
        Math.max(0, row.turn_index - before),
        row.turn_index + after,
      ) as unknown as MemoryRow[];
      for (const contextRow of contextRows) {
        const record = rowToRecord(contextRow);
        selected.set(record.memoryId, record);
      }
    }
    return [...selected.values()].sort(compareRecords);
  }

  getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[] {
    if (memoryIds.length === 0) return [];
    const statement = this.db.prepare(`
      SELECT memory_id, scope_id, session_id, turn_index, role, content,
             timestamp, content_hash, metadata_json
      FROM memories
      WHERE scope_id = ? AND memory_id = ?
    `);
    return [...new Set(memoryIds)]
      .map((memoryId) =>
        statement.get(scopeId, memoryId) as unknown as MemoryRow | undefined,
      )
      .filter((row): row is MemoryRow => row !== undefined)
      .map(rowToRecord)
      .sort(compareRecords);
  }

  hasScopeRecords(scopeId: string): boolean {
    return this.db.prepare(`
      SELECT 1 FROM memories WHERE scope_id = ? LIMIT 1
    `).get(scopeId) !== undefined;
  }

  listScopeRecords(scopeId: string): MemoryRecord[] {
    const rows = this.db
      .prepare(`
        SELECT memory_id, scope_id, session_id, turn_index, role, content,
               timestamp, content_hash, metadata_json
        FROM memories
        WHERE scope_id = ?
        ORDER BY timestamp IS NULL ASC, timestamp ASC,
                 session_id ASC, turn_index ASC
      `)
      .all(scopeId) as unknown as MemoryRow[];
    return rows.map(rowToRecord);
  }

  private assertEmbeddingProfileConsistent(profile: EmbeddingProfile): void {
    validateEmbeddingProfile(profile);
    const signature = JSON.stringify([profile.model, profile.dimensions]);
    const cached = this.validatedEmbeddingProfiles.get(profile.profileId);
    if (cached !== undefined) {
      if (cached !== signature) {
        throw new Error(`Embedding profile metadata conflict: ${profile.profileId}`);
      }
      return;
    }
    const profileConflict = this.db.prepare(`
      SELECT 1
      FROM memory_embeddings
      WHERE profile_id = ? AND (model <> ? OR dimensions <> ?)
      LIMIT 1
    `).get(
      profile.profileId,
      profile.model,
      profile.dimensions,
    );
    if (profileConflict) {
      throw new Error(`Embedding profile metadata conflict: ${profile.profileId}`);
    }
    this.validatedEmbeddingProfiles.set(profile.profileId, signature);
  }

  getEmbeddingIndexStatus(
    scopeId: string,
    profile: EmbeddingProfile,
  ): EmbeddingIndexStatus {
    this.assertEmbeddingProfileConsistent(profile);
    const cacheKey = JSON.stringify([
      scopeId,
      profile.profileId,
      profile.model,
      profile.dimensions,
    ]);
    const cached = this.completeEmbeddingStatuses.get(cacheKey);
    if (cached !== undefined) return { ...cached };

    // CROSS JOIN keeps SQLite on the selective scope-first lookup path.
    const hashConflict = this.db.prepare(`
      SELECT 1
      FROM memories AS m
      CROSS JOIN memory_embeddings AS e ON e.memory_id = m.memory_id
      WHERE m.scope_id = ? AND e.profile_id = ?
        AND e.content_hash <> m.content_hash
      LIMIT 1
    `).get(scopeId, profile.profileId);
    if (hashConflict) {
      throw new Error(`Embedding content hash conflict in scope ${scopeId}`);
    }
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM memories WHERE scope_id = ?
    `).get(scopeId) as unknown as { count: number };
    const indexedRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM memories AS m
      CROSS JOIN memory_embeddings AS e ON e.memory_id = m.memory_id
      WHERE m.scope_id = ? AND e.profile_id = ?
        AND e.model = ? AND e.dimensions = ?
        AND e.content_hash = m.content_hash
    `).get(
      scopeId,
      profile.profileId,
      profile.model,
      profile.dimensions,
    ) as unknown as { count: number };
    const status = {
      scopeId,
      profileId: profile.profileId,
      total: totalRow.count,
      indexed: indexedRow.count,
      missing: totalRow.count - indexedRow.count,
    };
    if (status.total > 0 && status.missing === 0) {
      this.completeEmbeddingStatuses.set(cacheKey, status);
    }
    return { ...status };
  }

  listMissingEmbeddingRecords(
    scopeId: string,
    profile: EmbeddingProfile,
  ): MemoryRecord[] {
    this.getEmbeddingIndexStatus(scopeId, profile);
    const rows = this.db.prepare(`
      SELECT m.memory_id, m.scope_id, m.session_id, m.turn_index, m.role,
             m.content, m.timestamp, m.content_hash, m.metadata_json
      FROM memories AS m
      WHERE m.scope_id = ? AND NOT EXISTS (
        SELECT 1 FROM memory_embeddings AS e
        WHERE e.memory_id = m.memory_id AND e.profile_id = ?
      )
      ORDER BY m.timestamp IS NULL ASC, m.timestamp ASC,
               m.session_id ASC, m.turn_index ASC
    `).all(scopeId, profile.profileId) as unknown as MemoryRow[];
    return rows.map(rowToRecord);
  }

  listMissingEmbeddingRecordsForRecords(
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
  ): MemoryRecord[] {
    this.assertEmbeddingProfileConsistent(profile);
    if (new Set(records.map((record) => record.memoryId)).size !== records.length) {
      throw new Error("Embedding record selection contains duplicate memory IDs");
    }
    const getRaw = this.db.prepare(`
      SELECT scope_id, content_hash FROM memories WHERE memory_id = ?
    `);
    const getExisting = this.db.prepare(`
      SELECT model, dimensions, content_hash
      FROM memory_embeddings
      WHERE memory_id = ? AND profile_id = ?
    `);
    return records.filter((record) => {
      const raw = getRaw.get(record.memoryId) as unknown as
        | { scope_id: string; content_hash: string }
        | undefined;
      if (!raw) throw new Error(`Cannot index missing memory: ${record.memoryId}`);
      if (raw.scope_id !== record.scopeId) {
        throw new Error(`Embedding memory scope mismatch: ${record.memoryId}`);
      }
      if (raw.content_hash !== record.contentHash) {
        throw new Error(`Embedding content hash mismatch: ${record.memoryId}`);
      }
      const existing = getExisting.get(
        record.memoryId,
        profile.profileId,
      ) as unknown as Omit<ExistingEmbeddingRow, "vector"> | undefined;
      if (!existing) return true;
      if (
        existing.model !== profile.model ||
        existing.dimensions !== profile.dimensions ||
        existing.content_hash !== record.contentHash
      ) {
        throw new Error(
          `Derived embedding conflict for immutable memory: ${record.memoryId}`,
        );
      }
      return false;
    });
  }

  beginVectorIndexGeneration(
    config: VectorIndexGenerationConfig,
  ): VectorIndexGenerationStatus {
    requiredIndexIdentity(config.generationId, "Vector generation ID");
    requiredIndexIdentity(config.collectionName, "Vector collection name");
    this.assertEmbeddingProfileConsistent(config.profile);
    const existing = this.vectorGenerationRow(config.generationId);
    if (existing) {
      if (
        existing.collection_name !== config.collectionName ||
        existing.profile_id !== config.profile.profileId ||
        existing.model !== config.profile.model ||
        existing.dimensions !== config.profile.dimensions
      ) {
        throw new Error(
          `Vector generation configuration conflict: ${config.generationId}`,
        );
      }
      return this.getVectorIndexGeneration(config.generationId);
    }
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO vector_index_generations (
        generation_id, collection_name, profile_id, model, dimensions,
        state, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, 'ingesting', ?, ?)
    `).run(
      config.generationId,
      config.collectionName,
      config.profile.profileId,
      config.profile.model,
      config.profile.dimensions,
      now,
      now,
    );
    return this.getVectorIndexGeneration(config.generationId);
  }

  storeEmbeddingBatch(
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
    vectors: readonly (readonly number[])[],
  ): StoreEmbeddingBatchResult {
    return this.storeEmbeddingBatchInternal(records, profile, vectors);
  }

  storeEmbeddingBatchForVectorGeneration(
    generationId: string,
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
    vectors: readonly (readonly number[])[],
  ): StoreEmbeddingBatchResult {
    requiredIndexIdentity(generationId, "Vector generation ID");
    return this.storeEmbeddingBatchInternal(
      records,
      profile,
      vectors,
      generationId,
    );
  }

  private storeEmbeddingBatchInternal(
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
    vectors: readonly (readonly number[])[],
    generationId?: string,
  ): StoreEmbeddingBatchResult {
    this.assertEmbeddingProfileConsistent(profile);
    if (records.length !== vectors.length) {
      throw new Error("Embedding record and vector counts must match");
    }
    if (records.length === 0) return { inserted: 0, unchanged: 0 };
    if (new Set(records.map((record) => record.memoryId)).size !== records.length) {
      throw new Error("Embedding batch contains duplicate memory IDs");
    }
    const scopeId = records[0]!.scopeId;
    if (records.some((record) => record.scopeId !== scopeId)) {
      throw new Error("Embedding batch must contain exactly one scope");
    }

    const getRaw = this.db.prepare(`
      SELECT scope_id, content_hash FROM memories WHERE memory_id = ?
    `);
    const encoded = records.map((record, index) => {
      const raw = getRaw.get(record.memoryId) as unknown as
        | { scope_id: string; content_hash: string }
        | undefined;
      if (!raw) throw new Error(`Cannot index missing memory: ${record.memoryId}`);
      if (raw.scope_id !== record.scopeId) {
        throw new Error(`Embedding memory scope mismatch: ${record.memoryId}`);
      }
      if (raw.content_hash !== record.contentHash) {
        throw new Error(`Embedding content hash mismatch: ${record.memoryId}`);
      }
      return encodeVector(vectors[index]!, profile.dimensions);
    });

    const getExisting = this.db.prepare(`
      SELECT model, dimensions, content_hash, vector
      FROM memory_embeddings
      WHERE memory_id = ? AND profile_id = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO memory_embeddings (
        memory_id, profile_id, model, dimensions, content_hash, vector
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertOutbox = this.db.prepare(`
      INSERT OR IGNORE INTO vector_sync_outbox (
        generation_id, scope_id, memory_id, profile_id, content_hash, state
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `);
    const getGeneration = this.db.prepare(`
      SELECT generation_id, collection_name, profile_id, model, dimensions,
             state, source_fingerprint, expected_vector_count,
             high_water_sequence, last_error
      FROM vector_index_generations
      WHERE generation_id = ?
    `);
    let inserted = 0;
    let unchanged = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (generationId !== undefined) {
        const generation = getGeneration.get(generationId) as unknown as
          | VectorGenerationRow
          | undefined;
        if (!generation) {
          throw new Error(`Unknown vector generation: ${generationId}`);
        }
        if (generation.state !== "ingesting") {
          throw new Error(
            `Vector generation is sealed for embedding writes: ${generationId}`,
          );
        }
        if (
          generation.profile_id !== profile.profileId ||
          generation.model !== profile.model ||
          generation.dimensions !== profile.dimensions
        ) {
          throw new Error(`Vector generation profile mismatch: ${generationId}`);
        }
      }
      records.forEach((record, index) => {
        const existing = getExisting.get(
          record.memoryId,
          profile.profileId,
        ) as unknown as ExistingEmbeddingRow | undefined;
        const vector = encoded[index]!;
        if (existing) {
          if (
            existing.model !== profile.model ||
            existing.dimensions !== profile.dimensions ||
            existing.content_hash !== record.contentHash ||
            !sameBytes(existing.vector, vector)
          ) {
            throw new Error(
              `Derived embedding conflict for immutable memory: ${record.memoryId}`,
            );
          }
          unchanged += 1;
        } else {
          insert.run(
            record.memoryId,
            profile.profileId,
            profile.model,
            profile.dimensions,
            record.contentHash,
            vector,
          );
          inserted += 1;
        }
        if (generationId !== undefined) {
          insertOutbox.run(
            generationId,
            record.scopeId,
            record.memoryId,
            profile.profileId,
            record.contentHash,
          );
        }
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, unchanged };
  }

  enqueueStoredRecordEmbeddingsForVectorGeneration(
    generationId: string,
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
  ): number {
    requiredIndexIdentity(generationId, "Vector generation ID");
    this.assertEmbeddingProfileConsistent(profile);
    if (records.length === 0) return 0;
    if (new Set(records.map((record) => record.memoryId)).size !== records.length) {
      throw new Error("Vector enqueue selection contains duplicate memory IDs");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this.vectorGenerationRow(generationId);
      if (!generation) throw new Error(`Unknown vector generation: ${generationId}`);
      if (generation.state !== "ingesting") {
        throw new Error(
          `Vector generation is sealed for embedding writes: ${generationId}`,
        );
      }
      if (
        generation.profile_id !== profile.profileId ||
        generation.model !== profile.model ||
        generation.dimensions !== profile.dimensions
      ) {
        throw new Error(`Vector generation profile mismatch: ${generationId}`);
      }
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO vector_sync_outbox (
          generation_id, scope_id, memory_id, profile_id, content_hash, state
        )
        SELECT ?, m.scope_id, m.memory_id, e.profile_id, e.content_hash, 'pending'
        FROM memories AS m
        JOIN memory_embeddings AS e ON e.memory_id = m.memory_id
        WHERE m.memory_id = ? AND m.scope_id = ?
          AND m.content_hash = ? AND e.profile_id = ?
          AND e.model = ? AND e.dimensions = ?
          AND e.content_hash = m.content_hash
      `);
      const getQueued = this.db.prepare(`
        SELECT scope_id, content_hash FROM vector_sync_outbox
        WHERE generation_id = ? AND memory_id = ? AND profile_id = ?
      `);
      let inserted = 0;
      for (const record of records) {
        inserted += Number(insert.run(
          generationId,
          record.memoryId,
          record.scopeId,
          record.contentHash,
          profile.profileId,
          profile.model,
          profile.dimensions,
        ).changes);
        const queued = getQueued.get(
          generationId,
          record.memoryId,
          profile.profileId,
        ) as unknown as { scope_id: string; content_hash: string } | undefined;
        if (!queued) {
          throw new Error(
            `Cannot enqueue missing embedding for memory: ${record.memoryId}`,
          );
        }
        if (
          queued.scope_id !== record.scopeId ||
          queued.content_hash !== record.contentHash
        ) {
          throw new Error(
            `Vector enqueue provenance conflict for memory: ${record.memoryId}`,
          );
        }
      }
      this.db.exec("COMMIT");
      return inserted;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  enqueueStoredScopeEmbeddingsForVectorGeneration(
    generationId: string,
    scopeId: string,
    profile: EmbeddingProfile,
  ): number {
    requiredIndexIdentity(generationId, "Vector generation ID");
    requiredIndexIdentity(scopeId, "Vector scope ID");
    const embeddingStatus = this.getEmbeddingIndexStatus(scopeId, profile);
    if (embeddingStatus.missing !== 0) {
      throw new Error(
        `Cannot enqueue incomplete embedding scope ${scopeId}: ` +
          `${embeddingStatus.indexed}/${embeddingStatus.total}`,
      );
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this.vectorGenerationRow(generationId);
      if (!generation) throw new Error(`Unknown vector generation: ${generationId}`);
      if (generation.state !== "ingesting") {
        throw new Error(
          `Vector generation is sealed for embedding writes: ${generationId}`,
        );
      }
      if (
        generation.profile_id !== profile.profileId ||
        generation.model !== profile.model ||
        generation.dimensions !== profile.dimensions
      ) {
        throw new Error(`Vector generation profile mismatch: ${generationId}`);
      }
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO vector_sync_outbox (
          generation_id, scope_id, memory_id, profile_id, content_hash, state
        )
        SELECT ?, m.scope_id, m.memory_id, e.profile_id, e.content_hash, 'pending'
        FROM memories AS m
        JOIN memory_embeddings AS e ON e.memory_id = m.memory_id
        WHERE m.scope_id = ? AND e.profile_id = ?
          AND e.model = ? AND e.dimensions = ?
          AND e.content_hash = m.content_hash
        ORDER BY m.memory_id ASC
      `).run(
        generationId,
        scopeId,
        profile.profileId,
        profile.model,
        profile.dimensions,
      );
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private vectorGenerationRow(
    generationId: string,
  ): VectorGenerationRow | undefined {
    return this.db.prepare(`
      SELECT generation_id, collection_name, profile_id, model, dimensions,
             state, source_fingerprint, expected_vector_count,
             high_water_sequence, last_error
      FROM vector_index_generations
      WHERE generation_id = ?
    `).get(generationId) as unknown as VectorGenerationRow | undefined;
  }

  getVectorIndexGeneration(
    generationId: string,
  ): VectorIndexGenerationStatus {
    requiredIndexIdentity(generationId, "Vector generation ID");
    const row = this.vectorGenerationRow(generationId);
    if (!row) throw new Error(`Unknown vector generation: ${generationId}`);
    const counts = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN state = 'synced' THEN 1 ELSE 0 END), 0) AS synced,
        COALESCE(SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN state = 'inflight' THEN 1 ELSE 0 END), 0) AS inflight
      FROM vector_sync_outbox
      WHERE generation_id = ?
    `).get(generationId) as unknown as VectorOutboxCountRow;
    return {
      generationId: row.generation_id,
      collectionName: row.collection_name,
      profile: {
        profileId: row.profile_id,
        model: row.model,
        dimensions: row.dimensions,
      },
      state: row.state,
      ...(row.source_fingerprint === null
        ? {}
        : { sourceFingerprint: row.source_fingerprint }),
      expectedVectorCount: row.expected_vector_count,
      syncedVectorCount: counts.synced,
      pendingVectorCount: counts.pending,
      inflightVectorCount: counts.inflight,
      highWaterSequence: row.high_water_sequence,
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
    };
  }

  private vectorGenerationFingerprint(generationId: string): string {
    const generation = this.vectorGenerationRow(generationId);
    if (!generation) throw new Error(`Unknown vector generation: ${generationId}`);
    const hash = createHash("sha256");
    hash.update(JSON.stringify([
      "pimem-qdrant-source-v1",
      generation.profile_id,
      generation.model,
      generation.dimensions,
    ]));
    const rows = this.db.prepare(`
      SELECT o.scope_id, o.memory_id, o.content_hash, e.vector
      FROM vector_sync_outbox AS o
      JOIN memory_embeddings AS e
        ON e.memory_id = o.memory_id AND e.profile_id = o.profile_id
      WHERE o.generation_id = ?
      ORDER BY o.scope_id ASC, o.memory_id ASC
    `).iterate(generationId) as unknown as Iterable<{
      scope_id: string;
      memory_id: string;
      content_hash: string;
      vector: Uint8Array;
    }>;
    for (const row of rows) {
      hash.update("\0");
      hash.update(JSON.stringify([
        row.scope_id,
        row.memory_id,
        row.content_hash,
        row.vector.byteLength,
      ]));
      hash.update("\0");
      hash.update(row.vector);
    }
    return hash.digest("hex");
  }

  sealVectorIndexGeneration(
    generationId: string,
  ): VectorIndexGenerationStatus {
    requiredIndexIdentity(generationId, "Vector generation ID");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this.vectorGenerationRow(generationId);
      if (!generation) throw new Error(`Unknown vector generation: ${generationId}`);
      if (generation.state === "failed") {
        throw new Error(`Cannot seal failed vector generation: ${generationId}`);
      }
      if (generation.state === "ingesting") {
        const aggregate = this.db.prepare(`
          SELECT COUNT(*) AS count, COALESCE(MAX(sequence_id), 0) AS high_water
          FROM vector_sync_outbox
          WHERE generation_id = ?
        `).get(generationId) as unknown as { count: number; high_water: number };
        this.db.prepare(`
          UPDATE vector_index_generations
          SET state = 'draining', expected_vector_count = ?,
              high_water_sequence = ?, updated_at_ms = ?
          WHERE generation_id = ? AND state = 'ingesting'
        `).run(
          aggregate.count,
          aggregate.high_water,
          Date.now(),
          generationId,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const sealed = this.vectorGenerationRow(generationId)!;
    if (sealed.source_fingerprint === null) {
      if (sealed.state !== "draining") {
        throw new Error(`Vector generation fingerprint is missing: ${generationId}`);
      }
      const fingerprint = this.vectorGenerationFingerprint(generationId);
      this.db.prepare(`
        UPDATE vector_index_generations
        SET source_fingerprint = ?, updated_at_ms = ?
        WHERE generation_id = ? AND state = 'draining'
          AND source_fingerprint IS NULL
      `).run(fingerprint, Date.now(), generationId);
    }
    return this.getVectorIndexGeneration(generationId);
  }

  claimVectorSyncBatch(
    generationId: string,
    limit: number,
    leaseMs: number,
    nowMs = Date.now(),
  ): VectorSyncClaim[] {
    requiredIndexIdentity(generationId, "Vector generation ID");
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000) {
      throw new Error("Vector sync batch limit must be between 1 and 10000");
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("Vector sync lease must be a positive integer");
    }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("Vector sync clock must be a non-negative integer");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this.vectorGenerationRow(generationId);
      if (!generation) throw new Error(`Unknown vector generation: ${generationId}`);
      if (!new Set<VectorIndexGenerationState>(["ingesting", "draining"]).has(
        generation.state,
      )) {
        throw new Error(
          `Vector generation does not accept sync claims: ${generationId}`,
        );
      }
      this.db.prepare(`
        UPDATE vector_sync_outbox
        SET state = 'pending', lease_until_ms = NULL
        WHERE generation_id = ? AND state = 'inflight'
          AND lease_until_ms <= ?
      `).run(generationId, nowMs);
      const pending = this.db.prepare(`
        SELECT sequence_id
        FROM vector_sync_outbox
        WHERE generation_id = ? AND state = 'pending'
        ORDER BY sequence_id ASC
        LIMIT ?
      `).all(generationId, limit) as unknown as Array<{ sequence_id: number }>;
      const claim = this.db.prepare(`
        UPDATE vector_sync_outbox
        SET state = 'inflight', attempts = attempts + 1,
            lease_until_ms = ?, last_error = NULL
        WHERE generation_id = ? AND sequence_id = ? AND state = 'pending'
      `);
      for (const row of pending) {
        const result = claim.run(
          nowMs + leaseMs,
          generationId,
          row.sequence_id,
        );
        if (result.changes !== 1) {
          throw new Error(`Cannot claim vector sync row: ${row.sequence_id}`);
        }
      }
      const getClaim = this.db.prepare(`
        SELECT o.sequence_id, o.generation_id, o.scope_id, o.memory_id,
               m.session_id, m.role, m.timestamp,
               o.profile_id, o.content_hash, o.attempts,
               e.vector, e.dimensions
        FROM vector_sync_outbox AS o
        JOIN memories AS m ON m.memory_id = o.memory_id
        JOIN memory_embeddings AS e
          ON e.memory_id = o.memory_id AND e.profile_id = o.profile_id
        WHERE o.generation_id = ? AND o.sequence_id = ? AND o.state = 'inflight'
      `);
      const rows = pending.map((row) =>
        getClaim.get(generationId, row.sequence_id) as unknown as VectorSyncRow
      );
      this.db.exec("COMMIT");
      return rows.map((row) => ({
        sequenceId: row.sequence_id,
        generationId: row.generation_id,
        scopeId: row.scope_id,
        memoryId: row.memory_id,
        sessionId: row.session_id,
        role: row.role,
        ...(row.timestamp === null ? {} : { timestamp: row.timestamp }),
        profileId: row.profile_id,
        contentHash: row.content_hash,
        vector: decodeVector(row.vector, row.dimensions),
        attempts: row.attempts,
      }));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeVectorSyncBatch(
    generationId: string,
    sequenceIds: readonly number[],
  ): void {
    this.updateVectorSyncBatch(generationId, sequenceIds, "synced");
  }

  releaseVectorSyncBatch(
    generationId: string,
    sequenceIds: readonly number[],
    error: unknown,
  ): void {
    this.updateVectorSyncBatch(
      generationId,
      sequenceIds,
      "pending",
      boundedIndexError(error),
    );
  }

  private updateVectorSyncBatch(
    generationId: string,
    sequenceIds: readonly number[],
    target: "pending" | "synced",
    lastError?: string,
  ): void {
    requiredIndexIdentity(generationId, "Vector generation ID");
    if (sequenceIds.length === 0) return;
    if (
      new Set(sequenceIds).size !== sequenceIds.length ||
      sequenceIds.some((value) => !Number.isSafeInteger(value) || value <= 0)
    ) {
      throw new Error("Vector sync sequence IDs must be unique positive integers");
    }
    const statement = target === "synced"
      ? this.db.prepare(`
          UPDATE vector_sync_outbox
          SET state = 'synced', lease_until_ms = NULL, last_error = NULL
          WHERE generation_id = ? AND sequence_id = ?
            AND state IN ('inflight', 'synced')
        `)
      : this.db.prepare(`
          UPDATE vector_sync_outbox
          SET state = 'pending', lease_until_ms = NULL, last_error = ?
          WHERE generation_id = ? AND sequence_id = ? AND state = 'inflight'
        `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const sequenceId of sequenceIds) {
        const result = target === "synced"
          ? statement.run(generationId, sequenceId)
          : statement.run(lastError ?? "Vector synchronization failed", generationId, sequenceId);
        if (result.changes !== 1) {
          throw new Error(`Cannot update vector sync row: ${sequenceId}`);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  beginVectorIndexVerification(
    generationId: string,
  ): VectorIndexGenerationStatus {
    const before = this.getVectorIndexGeneration(generationId);
    if (before.state === "verifying") return before;
    if (before.state !== "draining") {
      throw new Error(`Vector generation is not draining: ${generationId}`);
    }
    if (!before.sourceFingerprint) {
      throw new Error(`Vector generation fingerprint is missing: ${generationId}`);
    }
    if (
      before.pendingVectorCount !== 0 ||
      before.inflightVectorCount !== 0 ||
      before.syncedVectorCount !== before.expectedVectorCount
    ) {
      throw new Error(`Vector generation is not fully synchronized: ${generationId}`);
    }
    const result = this.db.prepare(`
      UPDATE vector_index_generations
      SET state = 'verifying', updated_at_ms = ?
      WHERE generation_id = ? AND state = 'draining'
    `).run(Date.now(), generationId);
    if (result.changes !== 1) {
      throw new Error(`Cannot begin vector generation verification: ${generationId}`);
    }
    return this.getVectorIndexGeneration(generationId);
  }

  markVectorIndexGenerationReady(
    generationId: string,
    observedVectorCount: number,
  ): VectorIndexGenerationStatus {
    const before = this.getVectorIndexGeneration(generationId);
    if (before.state === "ready") return before;
    if (before.state !== "verifying") {
      throw new Error(`Vector generation is not being verified: ${generationId}`);
    }
    if (observedVectorCount !== before.expectedVectorCount) {
      throw new Error(
        `Vector generation count mismatch: ${observedVectorCount}/${before.expectedVectorCount}`,
      );
    }
    if (!before.sourceFingerprint) {
      throw new Error(`Vector generation fingerprint is missing: ${generationId}`);
    }
    const result = this.db.prepare(`
      UPDATE vector_index_generations
      SET state = 'ready', last_error = NULL, updated_at_ms = ?
      WHERE generation_id = ? AND state = 'verifying'
    `).run(Date.now(), generationId);
    if (result.changes !== 1) {
      throw new Error(`Cannot mark vector generation ready: ${generationId}`);
    }
    return this.getVectorIndexGeneration(generationId);
  }

  failVectorIndexGeneration(generationId: string, error: unknown): void {
    const result = this.db.prepare(`
      UPDATE vector_index_generations
      SET state = 'failed', last_error = ?, updated_at_ms = ?
      WHERE generation_id = ? AND state <> 'ready'
    `).run(boundedIndexError(error), Date.now(), generationId);
    if (result.changes !== 1) {
      throw new Error(`Cannot fail vector generation: ${generationId}`);
    }
  }

  assertVectorIndexGenerationReady(
    generationId: string,
  ): VectorIndexGenerationStatus {
    const status = this.getVectorIndexGeneration(generationId);
    if (status.state !== "ready") {
      throw new Error(`Vector generation is not ready: ${generationId}`);
    }
    return status;
  }

  listVectorGenerationScopeCounts(
    generationId: string,
  ): Array<{ scopeId: string; count: number }> {
    this.getVectorIndexGeneration(generationId);
    const rows = this.db.prepare(`
      SELECT scope_id, COUNT(*) AS count
      FROM vector_sync_outbox
      WHERE generation_id = ?
      GROUP BY scope_id
      ORDER BY scope_id ASC
    `).all(generationId) as unknown as Array<{ scope_id: string; count: number }>;
    return rows.map((row) => ({ scopeId: row.scope_id, count: row.count }));
  }

  listStoredEmbeddings(
    scopeId: string,
    profile: EmbeddingProfile,
    request: Omit<SearchRequest, "queries" | "limit"> = {},
  ): StoredEmbeddingRecord[] {
    this.getEmbeddingIndexStatus(scopeId, profile);
    const where = [
      "m.scope_id = ?",
      "e.profile_id = ?",
      "e.model = ?",
      "e.dimensions = ?",
      "e.content_hash = m.content_hash",
    ];
    const params: Array<string | number> = [
      scopeId,
      profile.profileId,
      profile.model,
      profile.dimensions,
    ];
    if (request.sessionIds && request.sessionIds.length > 0) {
      where.push(
        `m.session_id IN (${request.sessionIds.map(() => "?").join(", ")})`,
      );
      params.push(...request.sessionIds);
    }
    if (request.roles && request.roles.length > 0) {
      where.push(`m.role IN (${request.roles.map(() => "?").join(", ")})`);
      params.push(...request.roles);
    }
    if (request.after) {
      where.push("m.timestamp >= ?");
      params.push(request.after);
    }
    if (request.before) {
      where.push("m.timestamp <= ?");
      params.push(request.before);
    }
    const rows = this.db.prepare(`
      SELECT m.memory_id, m.scope_id, m.session_id, m.turn_index, m.role,
             m.content, m.timestamp, m.content_hash, m.metadata_json,
             e.vector
      FROM memories AS m
      CROSS JOIN memory_embeddings AS e ON e.memory_id = m.memory_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.memory_id ASC
    `).all(...params) as unknown as EmbeddingRow[];
    return rows.map((row) => ({
      record: rowToRecord(row),
      vector: decodeVector(row.vector, profile.dimensions),
    }));
  }

  findMentionedMemoryIds(scopeId: string, text: string): string[] {
    return this.listScopeRecords(scopeId)
      .map((record) => record.memoryId)
      .filter((memoryId) => text.includes(memoryId));
  }

  async exportScope(scopeId: string, exportRoot: string): Promise<ScopeExport> {
    const records = this.listScopeRecords(scopeId);
    if (records.length === 0) {
      throw new Error(`Cannot export empty memory scope: ${scopeId}`);
    }
    const scopePath = join(exportRoot, safePathSegment(scopeId));
    await mkdir(exportRoot, { recursive: true });
    const stagingPath = await mkdtemp(join(exportRoot, ".scope-"));
    await mkdir(join(stagingPath, "sessions"), { recursive: true });

    const bySession = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const bucket = bySession.get(record.sessionId) ?? [];
      bucket.push(record);
      bySession.set(record.sessionId, bucket);
    }

    const manifest = {
      schemaVersion: 1,
      scopeId,
      memoryCount: records.length,
      sessions: [...bySession.keys()],
    };
    let published = false;
    try {
      await writeFile(
        join(stagingPath, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(stagingPath, "memory.jsonl"),
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
        "utf8",
      );
      await writeFile(
        join(stagingPath, "timeline.tsv"),
        [
          "timestamp\tsession_id\tturn_index\tmemory_id\trole",
          ...records.map((record) =>
            [
              record.timestamp ?? "",
              record.sessionId,
              record.turnIndex,
              record.memoryId,
              record.role,
            ].join("\t"),
          ),
        ].join("\n") + "\n",
        "utf8",
      );
      for (const [sessionId, sessionRecords] of bySession) {
        await writeFile(
          join(
            stagingPath,
            "sessions",
            `${safePathSegment(sessionId)}.jsonl`,
          ),
          sessionRecords.map((record) => JSON.stringify(record)).join("\n") +
            "\n",
          "utf8",
        );
      }
      try {
        await rename(stagingPath, scopePath);
        published = true;
      } catch (error) {
        if (!isExistingTargetError(error)) throw error;
      }
    } finally {
      if (!published) {
        await rm(stagingPath, { recursive: true, force: true });
      }
    }
    return { scopeId, path: scopePath, memoryCount: records.length };
  }

  static async create(
    databasePath: string,
    options: MemoryStoreOptions = {},
  ): Promise<MemoryStore> {
    if (!(options.readOnly ?? false)) {
      await mkdir(dirname(databasePath), { recursive: true });
    }
    return new MemoryStore(databasePath, options);
  }
}
