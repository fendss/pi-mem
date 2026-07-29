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
import { episodicPreview, safePathSegment } from "./util.js";

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

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
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
    `);
    this.evidenceOperators = new DatabaseEvidenceOperators(this.db);
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

  storeEmbeddingBatch(
    records: readonly MemoryRecord[],
    profile: EmbeddingProfile,
    vectors: readonly (readonly number[])[],
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
    let inserted = 0;
    let unchanged = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
          return;
        }
        insert.run(
          record.memoryId,
          profile.profileId,
          profile.model,
          profile.dimensions,
          record.contentHash,
          vector,
        );
        inserted += 1;
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, unchanged };
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

  static async create(databasePath: string): Promise<MemoryStore> {
    await mkdir(dirname(databasePath), { recursive: true });
    return new MemoryStore(databasePath);
  }
}
