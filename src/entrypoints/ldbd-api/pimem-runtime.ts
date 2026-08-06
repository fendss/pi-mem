import { createHash } from "node:crypto";
import { createRetrievalContext } from "../../composition/create-retrieval-context.js";
import { runPiMem } from "../../evidence-agent/run-pimem.js";
import { ingestMemorySessions } from "../../memory/ingest-memory-sessions.js";
import type { MemorySessionInput } from "../../memory/model/memory.js";
import type { PiModelRuntime } from "../../platform/pi/load-model-runtime.js";
import type { MemoryStore } from "../../platform/sqlite/pimem-store.js";
import type { LdbdSearchRequest } from "./contracts.js";
import { renderRetrievalQuestion } from "./contracts.js";
import type { LdbdInboxStore, StoredAddRequest } from "./inbox-store.js";

export interface LdbdSearchItem {
  id: string;
  content: string;
  score: number;
  created_at?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function snapshotScopeId(userId: string, adds: readonly StoredAddRequest[]): string {
  const snapshot = adds.map(({ sequence: _sequence, ...request }) => request);
  return `ldbd-${sha256(userId).slice(0, 12)}-${sha256(JSON.stringify(snapshot)).slice(0, 20)}`;
}

function sessionsForSnapshot(
  scopeId: string,
  adds: readonly StoredAddRequest[],
): MemorySessionInput[] {
  const bySession = new Map<string, StoredAddRequest[]>();
  for (const request of adds) {
    const bucket = bySession.get(request.sessionId) ?? [];
    bucket.push(request);
    bySession.set(request.sessionId, bucket);
  }
  return [...bySession.entries()].map(([sessionId, requests]) => {
    const messages = requests.flatMap((request) => request.messages);
    const firstTimestamp = messages.find((message) => message.timestamp !== undefined)?.timestamp;
    return {
      scopeId,
      sessionId,
      ...(firstTimestamp === undefined
        ? {}
        : { timestamp: new Date(firstTimestamp).toISOString() }),
      turns: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      metadata: { source: "ldbd-add-api" },
    };
  });
}

export class PiMemLdbdRuntime {
  constructor(
    private readonly inbox: LdbdInboxStore,
    private readonly store: MemoryStore,
    private readonly modelRuntime: PiModelRuntime,
  ) {}

  async search(request: LdbdSearchRequest): Promise<LdbdSearchItem[]> {
    const adds = this.inbox.listForUser(request.userId);
    if (adds.length === 0) throw new Error("No memories have been added for user_id");
    const scopeId = snapshotScopeId(request.userId, adds);
    await ingestMemorySessions(this.store, sessionsForSnapshot(scopeId, adds));
    const retrieval = createRetrievalContext(this.store, "fts5");
    const result = await runPiMem({
      store: retrieval.store,
      modelRuntime: this.modelRuntime,
      scopeId,
      question: renderRetrievalQuestion(request),
      maxRunMs: 300_000,
      maxTurns: 64,
      maxToolCalls: 80,
    });
    const evidence = new Map(result.evidence.map((memory) => [memory.memoryId, memory]));
    return result.citations
      .map((citation) => evidence.get(citation.memoryId))
      .filter((memory) => memory !== undefined)
      .slice(0, request.topK)
      .map((memory, index) => ({
        id: memory.memoryId,
        content: memory.content,
        score: 1 / (index + 1),
        ...(memory.timestamp === undefined ? {} : { created_at: memory.timestamp }),
      }));
  }
}
