import type { ModelUsage } from "../../../evidence-agent/index.js";

export const MEMORYARENA_PUBLIC_BENCHMARK = "MemoryArena Public";
export const MEMORYARENA_PUBLIC_MEMORY_SYSTEM = "pimem";

export interface MemoryArenaGenerationState {
  userId: string;
  memorySystemName: string;
  generation: number;
  nextOrdinal: number;
  pendingAppend?: {
    ordinal: number;
    chunkHash: string;
  };
}

export interface MemoryArenaInitializeInput {
  userId: string;
  memorySystemName: string;
}

export interface MemoryArenaAddInput extends MemoryArenaInitializeInput {
  chunk: string;
}

export interface MemoryArenaWrapInput extends MemoryArenaInitializeInput {
  question: string;
}

export interface MemoryArenaInitializeResult {
  userId: string;
  memorySystemName: string;
  generation: number;
}

export interface MemoryArenaAddResult {
  userId: string;
  response: null;
}

export interface MemoryArenaWrapResult {
  userId: string;
  prompt: string;
}

export interface MemoryArenaCitation {
  memoryId: string;
  supports: string;
}

export interface MemoryArenaInventoryItem {
  item: string;
  memoryIds: string[];
}

export interface MemoryArenaRetrievalResult {
  runId: string;
  status: "sufficient" | "insufficient";
  citations: MemoryArenaCitation[];
  inventory?: MemoryArenaInventoryItem[];
  trace: readonly unknown[];
  usage: ModelUsage;
  audit?: Record<string, unknown>;
}

export interface MemoryArenaOriginalChunk {
  memoryId: string;
  content: string;
}

export interface MemoryArenaWrapAuditRecord {
  schemaVersion: 1;
  userId: string;
  memorySystemName: string;
  generation: number;
  nextOrdinal: number;
  question: string;
  prompt: string;
  selectedMemoryIds: string[];
  retrieval?: MemoryArenaRetrievalResult;
}

export type MemoryArenaOperation =
  | "initialize"
  | "add"
  | "wrap_user_prompt";

/** Privacy-safe operation metadata. Request bodies never cross this port. */
export interface MemoryArenaOperationAuditStart {
  operation: MemoryArenaOperation;
  userId: string;
  memorySystemName: string;
  questionSha256?: string;
  chunkSha256?: string;
}

export interface MemoryArenaOperationAuditRetrieval {
  runId: string;
  status: MemoryArenaRetrievalResult["status"];
  usage: ModelUsage;
}

export interface MemoryArenaEmbeddingMetrics {
  calls: number;
  latencyMs: number;
  inputTokens: number;
  usageMissingCalls: number;
}

/** Exact provider-attempt totals attributed to one logical memory operation. */
export interface MemoryArenaOperationEmbeddingAudit {
  measurement: "async_context";
  delta: MemoryArenaEmbeddingMetrics;
}

export interface MemoryArenaOperationTraceSummary {
  entries: number;
  errorEntries: number;
  byTool: Record<string, number>;
}

export interface MemoryArenaOperationFailedRetrieval {
  runId: string;
  turns: number;
  toolCalls: number;
  candidateCount: number;
  evidenceCount: number;
  trace: MemoryArenaOperationTraceSummary;
  usage: ModelUsage;
}

export interface MemoryArenaOperationAuditSuccess {
  generation?: number;
  ordinal?: number;
  nextOrdinal?: number;
  retrieval?: MemoryArenaOperationAuditRetrieval;
  embedding?: MemoryArenaOperationEmbeddingAudit;
}

export interface MemoryArenaOperationAuditFailure {
  errorCode: MemoryArenaErrorCode | "internal_error";
  retryable: boolean;
  httpStatus: number;
  retrieval?: MemoryArenaOperationFailedRetrieval;
  embedding?: MemoryArenaOperationEmbeddingAudit;
}

export interface MemoryArenaOperationErrorDiagnostics {
  embedding: MemoryArenaOperationEmbeddingAudit;
}

export type MemoryArenaErrorCode =
  | "contract_error"
  | "unsupported_memory_system"
  | "user_not_initialized"
  | "memory_system_mismatch"
  | "generation_conflict"
  | "append_pending"
  | "source_integrity_error"
  | "upstream_unauthorized"
  | "upstream_forbidden"
  | "upstream_unavailable"
  | "state_unavailable"
  | "artifact_unavailable";

export class MemoryArenaPublicError extends Error {
  readonly code: MemoryArenaErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly diagnostics?: MemoryArenaOperationErrorDiagnostics;

  constructor(options: {
    code: MemoryArenaErrorCode;
    message: string;
    httpStatus: number;
    retryable?: boolean;
    cause?: unknown;
    diagnostics?: MemoryArenaOperationErrorDiagnostics;
  }) {
    super(options.message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "MemoryArenaPublicError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    if (options.diagnostics !== undefined) {
      this.diagnostics = options.diagnostics;
    }
  }
}

/** Preserves operation diagnostics without changing an internal error into HTTP policy. */
export class MemoryArenaOperationDiagnosticError extends Error {
  readonly diagnostics: MemoryArenaOperationErrorDiagnostics;

  constructor(options: {
    message: string;
    cause: unknown;
    diagnostics: MemoryArenaOperationErrorDiagnostics;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "MemoryArenaOperationDiagnosticError";
    this.diagnostics = options.diagnostics;
  }
}

export function userNotInitialized(): MemoryArenaPublicError {
  return new MemoryArenaPublicError({
    code: "user_not_initialized",
    message: "User not initialized",
    httpStatus: 404,
  });
}

export function memorySystemMismatch(): MemoryArenaPublicError {
  return new MemoryArenaPublicError({
    code: "memory_system_mismatch",
    message: "Mismatched memory_system for user",
    httpStatus: 400,
  });
}

export function unsupportedMemorySystem(name: string): MemoryArenaPublicError {
  return new MemoryArenaPublicError({
    code: "unsupported_memory_system",
    message: `Unsupported memory_system: ${name}`,
    httpStatus: 400,
  });
}
