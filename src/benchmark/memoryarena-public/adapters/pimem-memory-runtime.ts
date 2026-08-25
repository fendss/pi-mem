import {
  runPiMem,
  type PiMemResult,
  type PiMemRuntimeStore,
  type PiMemSkill,
  type RunPiMemOptions,
} from "../../../evidence-agent/index.js";
import type { OnlineMemoryStore } from "../../../memory/index.js";
import type { PiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import type { MemoryStore } from "../../../platform/sqlite/pimem-store.js";
import {
  indexScopeEmbeddings,
  type Embedder,
  type SearchOperatorRegistry,
} from "../../../retrieval/index.js";
import { sha256 } from "../../../util.js";
import {
  MemoryArenaPublicError,
  type MemoryArenaOriginalChunk,
  type MemoryArenaRetrievalResult,
} from "../model/memory-backend.js";
import type {
  MemoryArenaChunkMemory,
  MemoryArenaEvidenceRetriever,
} from "../ports/memory-backend.js";

type RunPiMem = typeof runPiMem;

export interface PiMemMemoryArenaAdapterOptions {
  rawStore: MemoryStore & OnlineMemoryStore;
  runtimeStore: PiMemRuntimeStore;
  operatorRegistry: SearchOperatorRegistry;
  embedder: Embedder;
  modelRuntime: PiModelRuntime;
  skill?: PiMemSkill;
  maxRunMs?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  runPiMemImpl?: RunPiMem;
}

export function memoryArenaPublicScopeId(
  userId: string,
  generation: number,
): string {
  return `memoryarena-${sha256(userId).slice(0, 24)}-g${generation}`;
}

function appendRequestIdentity(options: {
  userId: string;
  generation: number;
  ordinal: number;
  chunk: string;
}): { requestId: string; requestHash: string; sourceSessionId: string } {
  const userHash = sha256(options.userId).slice(0, 24);
  const sourceSessionId = `chunk-${options.ordinal}`;
  return {
    requestId:
      `memoryarena-${userHash}-g${options.generation}-o${options.ordinal}`,
    requestHash: sha256(JSON.stringify({
      userId: options.userId,
      generation: options.generation,
      ordinal: options.ordinal,
      chunk: options.chunk,
    })),
    sourceSessionId,
  };
}

export function memoryArenaRetryableUpstreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:HTTP(?:\s+error)?\s*[:=]?\s*(?:408|425|429|5\d\d)\b|(?:408|425|429|5\d\d)\s+status\s+code\b|status(?:\s+code)?\s*[:=]\s*(?:408|425|429|5\d\d)\b|error\s+code\s*[:=]\s*(?:408|425|429|5\d\d)\b|rate[ -]?limit|too many requests|timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|temporar(?:y|ily) unavailable|service unavailable)/iu.test(
    message,
  );
}

export function memoryArenaUpstreamAuthStatus(
  error: unknown,
): 401 | 403 | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const contextualStatus = message.match(
    /(?:\bHTTP(?:\s+error)?(?:\s+status(?:\s+code)?)?\s*[:=]?\s*(401|403)\b|\b(401|403)\s+status\s+code\b|\bstatus(?:\s+code)?\s*[:=]\s*(401|403)\b|\berror\s+code\s*[:=]\s*(401|403)\b)/iu,
  );
  const status = contextualStatus?.slice(1).find((value) => value !== undefined);
  if (status === "401" || /(?:invalid|incorrect|missing)\s+(?:api[ -]?)?key\b|invalid authentication|authentication failed|\bunauthori[sz]ed\b/iu.test(message)) {
    return 401;
  }
  if (status === "403" || /\bforbidden\b|permission denied/iu.test(message)) {
    return 403;
  }
  return undefined;
}

function mapUpstreamError(
  error: unknown,
  operation: string,
): never {
  let mapped: unknown = error;
  const authStatus = memoryArenaUpstreamAuthStatus(error);
  if (!(error instanceof MemoryArenaPublicError) && authStatus !== undefined) {
    mapped = new MemoryArenaPublicError({
      code: authStatus === 401
        ? "upstream_unauthorized"
        : "upstream_forbidden",
      message: authStatus === 401
        ? `PiMem ${operation} upstream authentication failed`
        : `PiMem ${operation} is forbidden by the upstream provider`,
      httpStatus: authStatus,
      retryable: false,
      cause: error,
    });
  } else if (
    !(error instanceof MemoryArenaPublicError) &&
    memoryArenaRetryableUpstreamError(error)
  ) {
    mapped = new MemoryArenaPublicError({
      code: "upstream_unavailable",
      message: `PiMem ${operation} is temporarily unavailable`,
      httpStatus: 503,
      retryable: true,
      cause: error,
    });
  }
  throw mapped;
}

/** Maps the official memory backend lifecycle onto immutable PiMem source chunks. */
export class PiMemMemoryArenaAdapter
  implements MemoryArenaChunkMemory, MemoryArenaEvidenceRetriever {
  private readonly run: RunPiMem;

  constructor(private readonly options: PiMemMemoryArenaAdapterOptions) {
    this.run = options.runPiMemImpl ?? runPiMem;
  }

  async appendOriginalChunk(options: {
    userId: string;
    generation: number;
    ordinal: number;
    chunk: string;
  }): Promise<void> {
    const scopeId = memoryArenaPublicScopeId(options.userId, options.generation);
    const identity = appendRequestIdentity(options);
    let appended: ReturnType<MemoryStore["appendMemoryRequest"]>;
    try {
      appended = this.options.rawStore.appendMemoryRequest({
        requestId: identity.requestId,
        requestHash: identity.requestHash,
        scopeId,
        sourceSessionId: identity.sourceSessionId,
        messages: [{ role: "other", content: options.chunk }],
      });
    } catch (error) {
      mapUpstreamError(error, "memory append");
    }

    try {
      const indexed = await indexScopeEmbeddings(
        this.options.rawStore,
        scopeId,
        this.options.embedder,
      );
      if (indexed.total === 0 || indexed.missing !== 0) {
        throw new Error(
          `MemoryArena embedding index is incomplete for ${scopeId}: ` +
          `${indexed.indexed}/${indexed.total}`,
        );
      }
      if (appended.status === "pending") {
        this.options.rawStore.markAppendRequestComplete(
          identity.requestId,
          identity.requestHash,
        );
      }
    } catch (error) {
      mapUpstreamError(error, "memory append");
    }
  }

  async readOriginalChunks(options: {
    userId: string;
    generation: number;
    memoryIds: readonly string[];
  }): Promise<MemoryArenaOriginalChunk[]> {
    const scopeId = memoryArenaPublicScopeId(options.userId, options.generation);
    return this.options.rawStore
      .getRecords(scopeId, [...options.memoryIds])
      .map((record) => ({ memoryId: record.memoryId, content: record.content }));
  }

  async retrieve(options: {
    userId: string;
    generation: number;
    question: string;
  }): Promise<MemoryArenaRetrievalResult> {
    const scopeId = memoryArenaPublicScopeId(options.userId, options.generation);
    let result: PiMemResult;
    try {
      const runtimeOptions: RunPiMemOptions = {
        store: this.options.runtimeStore,
        operatorRegistry: this.options.operatorRegistry,
        modelRuntime: this.options.modelRuntime,
        scopeId,
        question: options.question,
        skill: this.options.skill ?? "pimem-v0",
        ...(this.options.maxRunMs === undefined
          ? {}
          : { maxRunMs: this.options.maxRunMs }),
        ...(this.options.maxTurns === undefined
          ? {}
          : { maxTurns: this.options.maxTurns }),
        ...(this.options.maxToolCalls === undefined
          ? {}
          : { maxToolCalls: this.options.maxToolCalls }),
      };
      result = await this.run(runtimeOptions);
    } catch (error) {
      mapUpstreamError(error, "retrieval");
    }
    return {
      runId: result.runId,
      status: result.status,
      citations: result.citations.map((citation) => ({ ...citation })),
      ...(result.inventory === undefined
        ? {}
        : {
            inventory: result.inventory.map((item) => ({
              item: item.item,
              memoryIds: [...item.memoryIds],
            })),
          }),
      trace: result.trace.map((entry) => ({ ...entry })),
      usage: {
        ...result.usage,
        cost: { ...result.usage.cost },
      },
      audit: {
        evidence_summary: result.evidenceSummary,
        metrics: result.metrics,
        retrieval: result.retrieval,
        retrieval_model: result.retrievalModel,
        candidates: result.candidates,
        evidence: result.evidence,
      },
    };
  }
}
