export type MemoryRole = "user" | "assistant" | "system" | "other";

export interface MemoryTurnInput {
  id?: string;
  role: MemoryRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySessionInput {
  scopeId: string;
  sessionId: string;
  timestamp?: string;
  turns: MemoryTurnInput[];
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  memoryId: string;
  scopeId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  content: string;
  timestamp?: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export type ScopeIngestStatus = "inserted" | "unchanged";
