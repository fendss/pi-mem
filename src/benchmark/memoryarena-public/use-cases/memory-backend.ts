import { createHash } from "node:crypto";
import {
  MemoryArenaPublicError,
  MemoryArenaOperationDiagnosticError,
  memorySystemMismatch,
  unsupportedMemorySystem,
  userNotInitialized,
  type MemoryArenaAddInput,
  type MemoryArenaAddResult,
  type MemoryArenaGenerationState,
  type MemoryArenaInitializeInput,
  type MemoryArenaInitializeResult,
  type MemoryArenaOperationAuditFailure,
  type MemoryArenaOperationFailedRetrieval,
  type MemoryArenaOperationAuditStart,
  type MemoryArenaOperationAuditSuccess,
  type MemoryArenaOperationEmbeddingAudit,
  type MemoryArenaRetrievalResult,
  type MemoryArenaWrapInput,
  type MemoryArenaWrapResult,
} from "../model/memory-backend.js";
import type {
  MemoryArenaOperationAuditSpan,
  MemoryArenaPublicBackendDependencies,
} from "../ports/memory-backend.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeCount(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = finiteNumber(record, key);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function modelUsage(
  value: unknown,
): MemoryArenaOperationFailedRetrieval["usage"] | undefined {
  const usage = recordValue(value);
  const cost = recordValue(usage?.cost);
  if (usage === undefined || cost === undefined) return undefined;
  const input = finiteNumber(usage, "input");
  const output = finiteNumber(usage, "output");
  const cacheRead = finiteNumber(usage, "cacheRead");
  const cacheWrite = finiteNumber(usage, "cacheWrite");
  const totalTokens = finiteNumber(usage, "totalTokens");
  const costInput = finiteNumber(cost, "input");
  const costOutput = finiteNumber(cost, "output");
  const costCacheRead = finiteNumber(cost, "cacheRead");
  const costCacheWrite = finiteNumber(cost, "cacheWrite");
  const costTotal = finiteNumber(cost, "total");
  if (
    input === undefined || output === undefined || cacheRead === undefined ||
    cacheWrite === undefined || totalTokens === undefined ||
    costInput === undefined || costOutput === undefined ||
    costCacheRead === undefined || costCacheWrite === undefined ||
    costTotal === undefined
  ) return undefined;
  const cacheWrite1h = finiteNumber(usage, "cacheWrite1h");
  const reasoning = finiteNumber(usage, "reasoning");
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}

function piMemFailureDiagnostics(
  error: unknown,
): MemoryArenaOperationFailedRetrieval | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = recordValue(current);
    if (current instanceof Error && current.name === "PiMemRunError") {
      const diagnostics = recordValue(candidate?.diagnostics);
      const usage = modelUsage(diagnostics?.usage);
      const runId = diagnostics?.runId;
      const turns = diagnostics === undefined
        ? undefined
        : safeCount(diagnostics, "turns");
      const toolCalls = diagnostics === undefined
        ? undefined
        : safeCount(diagnostics, "toolCalls");
      if (
        diagnostics !== undefined && typeof runId === "string" &&
        turns !== undefined && toolCalls !== undefined && usage !== undefined
      ) {
        const trace = Array.isArray(diagnostics.trace) ? diagnostics.trace : [];
        const tools = new Map<string, number>();
        let errorEntries = 0;
        for (const entry of trace) {
          const traceEntry = recordValue(entry);
          if (traceEntry?.isError === true) errorEntries += 1;
          const rawTool = traceEntry?.toolName;
          const tool = typeof rawTool === "string" && rawTool.length > 0
            ? rawTool.slice(0, 128)
            : "unknown";
          tools.set(tool, (tools.get(tool) ?? 0) + 1);
        }
        return {
          runId,
          turns,
          toolCalls,
          candidateCount: Array.isArray(diagnostics.candidates)
            ? diagnostics.candidates.length
            : 0,
          evidenceCount: Array.isArray(diagnostics.evidence)
            ? diagnostics.evidence.length
            : 0,
          trace: {
            entries: trace.length,
            errorEntries,
            byTool: Object.fromEntries(
              [...tools.entries()].sort(([left], [right]) =>
                left.localeCompare(right)
              ),
            ),
          },
          usage,
        };
      }
    }
    current = candidate?.cause;
  }
  return undefined;
}

function operationFailure(error: unknown): MemoryArenaOperationAuditFailure {
  const retrieval = piMemFailureDiagnostics(error);
  const embedding = operationEmbeddingDiagnostics(error);
  if (error instanceof MemoryArenaPublicError) {
    return {
      errorCode: error.code,
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      ...(retrieval === undefined ? {} : { retrieval }),
      ...(embedding === undefined ? {} : { embedding }),
    };
  }
  return {
    errorCode: "internal_error",
    retryable: false,
    httpStatus: 500,
    ...(retrieval === undefined ? {} : { retrieval }),
    ...(embedding === undefined ? {} : { embedding }),
  };
}

function operationEmbeddingDiagnostics(
  error: unknown,
): MemoryArenaOperationEmbeddingAudit | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (
      current instanceof MemoryArenaPublicError ||
      current instanceof MemoryArenaOperationDiagnosticError
    ) {
      if (current.diagnostics !== undefined) {
        return current.diagnostics.embedding;
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

function operationAuditUnavailable(
  error: unknown,
  embedding?: MemoryArenaOperationEmbeddingAudit,
): MemoryArenaPublicError {
  if (
    error instanceof MemoryArenaPublicError &&
    error.code === "artifact_unavailable" &&
    (embedding === undefined || error.diagnostics !== undefined)
  ) {
    return error;
  }
  return new MemoryArenaPublicError({
    code: "artifact_unavailable",
    message: "MemoryArena operation audit could not be persisted",
    httpStatus: 503,
    retryable: true,
    cause: error,
    ...(embedding === undefined ? {} : { diagnostics: { embedding } }),
  });
}

function cloneRetrieval(
  retrieval: MemoryArenaRetrievalResult,
): MemoryArenaRetrievalResult {
  return {
    ...retrieval,
    citations: retrieval.citations.map((citation) => ({ ...citation })),
    trace: [...retrieval.trace],
    usage: {
      ...retrieval.usage,
      cost: { ...retrieval.usage.cost },
    },
    ...(retrieval.inventory === undefined
      ? {}
      : {
          inventory: retrieval.inventory.map((item) => ({
            item: item.item,
            memoryIds: [...item.memoryIds],
          })),
        }),
    ...(retrieval.audit === undefined
      ? {}
      : { audit: { ...retrieval.audit } }),
  };
}

function selectedMemoryIds(retrieval: MemoryArenaRetrievalResult): string[] {
  const selected = new Set<string>();
  for (const citation of retrieval.citations) selected.add(citation.memoryId);
  for (const item of retrieval.inventory ?? []) {
    for (const memoryId of item.memoryIds) selected.add(memoryId);
  }
  return [...selected];
}

export function renderMemoryArenaPublicPrompt(
  question: string,
  chunks: readonly string[],
): string {
  return [
    "<memory_context>",
    ...(chunks.length === 0
      ? ["None"]
      : chunks.map((chunk) => `<memory>${chunk}</memory>`)),
    "</memory_context>",
    `User: ${question}`,
  ].join("\n");
}

export class MemoryArenaPublicMemoryBackend {
  constructor(private readonly dependencies: MemoryArenaPublicBackendDependencies) {
    if (!dependencies.memorySystemName.trim()) {
      throw new Error("MemoryArena memory system name must not be empty");
    }
  }

  async initialize(
    input: MemoryArenaInitializeInput,
  ): Promise<MemoryArenaInitializeResult> {
    return this.audited({
      operation: "initialize",
      userId: input.userId,
      memorySystemName: input.memorySystemName,
    }, async () => {
      this.assertSupportedSystem(input.memorySystemName);
      const state = await this.dependencies.generations.initialize(
        input.userId,
        input.memorySystemName,
      );
      return {
        result: {
          userId: state.userId,
          memorySystemName: state.memorySystemName,
          generation: state.generation,
        },
        audit: { generation: state.generation },
      };
    });
  }

  async add(input: MemoryArenaAddInput): Promise<MemoryArenaAddResult> {
    return this.audited({
      operation: "add",
      userId: input.userId,
      memorySystemName: input.memorySystemName,
      chunkSha256: sha256(input.chunk),
    }, async () => {
      const state = await this.activeState(input);
      const ordinal = await this.dependencies.generations.reserveAppend({
        userId: input.userId,
        generation: state.generation,
        chunk: input.chunk,
      });
      await this.dependencies.chunks.appendOriginalChunk({
        userId: input.userId,
        generation: state.generation,
        ordinal,
        chunk: input.chunk,
      });
      const completed = await this.dependencies.generations.completeAppend({
        userId: input.userId,
        generation: state.generation,
        ordinal,
        chunk: input.chunk,
      });
      return {
        result: { userId: input.userId, response: null },
        audit: {
          generation: completed.generation,
          ordinal,
          nextOrdinal: completed.nextOrdinal,
        },
      };
    });
  }

  async wrap(input: MemoryArenaWrapInput): Promise<MemoryArenaWrapResult> {
    return this.audited({
      operation: "wrap_user_prompt",
      userId: input.userId,
      memorySystemName: input.memorySystemName,
      questionSha256: sha256(input.question),
    }, async () => {
      const state = await this.activeState(input);
      if (state.pendingAppend !== undefined) {
        throw new MemoryArenaPublicError({
          code: "append_pending",
          message: `Memory append ${state.pendingAppend.ordinal} is incomplete`,
          httpStatus: 503,
          retryable: true,
        });
      }

      let retrieval: MemoryArenaRetrievalResult | undefined;
      let ids: string[] = [];
      let chunks: string[] = [];
      if (state.nextOrdinal > 0) {
        retrieval = await this.dependencies.retriever.retrieve({
          userId: state.userId,
          generation: state.generation,
          question: input.question,
        });
        ids = selectedMemoryIds(retrieval);
        if (ids.length > 0) {
          const originals = await this.dependencies.chunks.readOriginalChunks({
            userId: state.userId,
            generation: state.generation,
            memoryIds: ids,
          });
          const byId = new Map(
            originals.map((chunk) => [chunk.memoryId, chunk.content]),
          );
          const missing = ids.filter((memoryId) => !byId.has(memoryId));
          if (missing.length > 0) {
            throw new MemoryArenaPublicError({
              code: "source_integrity_error",
              message: `PiMem selected missing source chunks: ${missing.join(", ")}`,
              httpStatus: 500,
            });
          }
          chunks = ids.map((memoryId) => byId.get(memoryId)!);
        }
      }

      const prompt = renderMemoryArenaPublicPrompt(input.question, chunks);
      try {
        await this.dependencies.audits.record({
          schemaVersion: 1,
          userId: state.userId,
          memorySystemName: state.memorySystemName,
          generation: state.generation,
          nextOrdinal: state.nextOrdinal,
          question: input.question,
          prompt,
          selectedMemoryIds: ids,
          ...(retrieval === undefined
            ? {}
            : { retrieval: cloneRetrieval(retrieval) }),
        });
      } catch (error) {
        if (error instanceof MemoryArenaPublicError) throw error;
        throw new MemoryArenaPublicError({
          code: "artifact_unavailable",
          message: "MemoryArena wrap audit could not be persisted",
          httpStatus: 503,
          retryable: true,
          cause: error,
        });
      }
      return {
        result: { userId: state.userId, prompt },
        audit: {
          generation: state.generation,
          nextOrdinal: state.nextOrdinal,
          ...(retrieval === undefined
            ? {}
            : {
                retrieval: {
                  runId: retrieval.runId,
                  status: retrieval.status,
                  usage: {
                    ...retrieval.usage,
                    cost: { ...retrieval.usage.cost },
                  },
                },
              }),
        },
      };
    });
  }

  private async audited<T>(
    start: MemoryArenaOperationAuditStart,
    operation: () => Promise<{
      result: T;
      audit: MemoryArenaOperationAuditSuccess;
    }>,
  ): Promise<T> {
    let span: MemoryArenaOperationAuditSpan;
    try {
      span = await this.dependencies.operationAudits.begin(start);
    } catch (error) {
      throw operationAuditUnavailable(error);
    }

    let outcome: { result: T; audit: MemoryArenaOperationAuditSuccess };
    try {
      if (start.operation === "initialize") {
        outcome = await operation();
      } else {
        const measured = await this.dependencies.embeddingMeter.measureOperation(
          operation,
        );
        outcome = {
          result: measured.result.result,
          audit: {
            ...measured.result.audit,
            embedding: measured.embedding,
          },
        };
      }
    } catch (error) {
      try {
        await span.fail(operationFailure(error));
      } catch (auditError) {
        throw operationAuditUnavailable(auditError);
      }
      throw error;
    }

    try {
      await span.succeed(outcome.audit);
    } catch (error) {
      const unavailable = operationAuditUnavailable(error, outcome.audit.embedding);
      try {
        await span.fail(operationFailure(unavailable));
      } catch {
        // The primary failure is that the durable audit is unavailable.
      }
      throw unavailable;
    }
    return outcome.result;
  }

  private assertSupportedSystem(memorySystemName: string): void {
    if (memorySystemName !== this.dependencies.memorySystemName) {
      throw unsupportedMemorySystem(memorySystemName);
    }
  }

  private async activeState(
    input: MemoryArenaInitializeInput,
  ): Promise<MemoryArenaGenerationState> {
    const state = await this.dependencies.generations.get(input.userId);
    if (state === undefined) throw userNotInitialized();
    if (state.memorySystemName !== input.memorySystemName) {
      throw memorySystemMismatch();
    }
    return state;
  }
}
