import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { LdbdAddRequest } from "./contracts.js";

interface AddRow {
  sequence: number;
  request_id: string;
  user_id: string;
  session_id: string;
  payload_hash: string;
  messages_json: string;
}

export interface StoredAddRequest extends LdbdAddRequest {
  sequence: number;
}

function requestHash(request: LdbdAddRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export class LdbdInboxStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ldbd_add_requests (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ldbd_add_requests_user_sequence
        ON ldbd_add_requests(user_id, sequence);
    `);
  }

  close(): void {
    this.database.close();
  }

  put(request: LdbdAddRequest): "inserted" | "unchanged" {
    const hash = requestHash(request);
    const existing = this.database.prepare(`
      SELECT payload_hash FROM ldbd_add_requests WHERE request_id = ?
    `).get(request.requestId) as { payload_hash: string } | undefined;
    if (existing) {
      if (existing.payload_hash !== hash) {
        throw new Error("request_id already exists with different content");
      }
      return "unchanged";
    }
    this.database.prepare(`
      INSERT INTO ldbd_add_requests (
        request_id, user_id, session_id, payload_hash, messages_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      request.requestId,
      request.userId,
      request.sessionId,
      hash,
      JSON.stringify(request.messages),
      new Date().toISOString(),
    );
    return "inserted";
  }

  listForUser(userId: string): StoredAddRequest[] {
    const rows = this.database.prepare(`
      SELECT sequence, request_id, user_id, session_id, payload_hash, messages_json
      FROM ldbd_add_requests
      WHERE user_id = ?
      ORDER BY sequence ASC
    `).all(userId) as unknown as AddRow[];
    return rows.map((row) => ({
      sequence: row.sequence,
      requestId: row.request_id,
      userId: row.user_id,
      sessionId: row.session_id,
      messages: JSON.parse(row.messages_json) as LdbdAddRequest["messages"],
    }));
  }
}
