import { Agent } from "@earendil-works/pi-agent-core";
import { createEphemeralMemoryContext } from "./ephemeral-context.js";
import {
  aggregateAssistantUsage,
  assistantMessageText,
  lastAssistantMessage,
  validateResponseModels,
} from "./assistant-messages.js";
import {
  PI_MEM_TOOL_SYSTEM_PROMPT,
  piMemSystemPrompt,
  type PiMemSkill,
} from "./retrieval-prompt.js";
import { MemoryLedger } from "../../model/ledger.js";
import type { PiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import {
  createToolProtocolBeforeToolCall,
  createPiMemTools,
  type MemoryToolStore,
} from "./tools.js";
import type {
  ModelUsage,
  PiMemResult,
  ToolTraceEntry,
} from "../../model/evidence.js";
import type {
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchOperatorCatalogIdentity,
  SearchOperatorDefinition,
  SearchOperatorDefinitionSnapshot,
  SearchOperatorRegistry,
} from "../../../retrieval/index.js";
import type { MemoryRecord } from "../../../memory/index.js";
import { assertNonEmpty, newRunId } from "../../../util.js";
import type { ReadOnlyNavigationBinding } from "../../ports/read-only-navigation.js";

export const PIMEM_HARNESS_VERSION = "pimem-evidence-transaction-v2";

export interface PiMemRuntimeStore extends MemoryToolStore {
  findMentionedMemoryIds(scopeId: string, text: string): string[];
  getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[];
  getRetrievalMetadata?(): RetrievalMetadata;
  snapshotRetrievalMetrics?(): RetrievalMetricsSnapshot;
}

export interface RunPiMemOptions {
  store: PiMemRuntimeStore;
  operatorRegistry: SearchOperatorRegistry;
  modelRuntime: PiModelRuntime;
  scopeId: string;
  question: string;
  questionDate?: string;
  readOnlyNavigation?: ReadOnlyNavigationBinding;
  maxTurns?: number;
  maxToolCalls?: number;
  /** Optional evaluation/runtime budget for actual search executions. */
  maxSearchCalls?: number;
  maxProtocolNudges?: number;
  maxRunMs?: number;
  systemPrompt?: string;
  skill?: PiMemSkill;
  /** Approved declarative operators loaded into this run before the Agent starts. */
  operatorDefinitions?: readonly SearchOperatorDefinition[];
  /** Total preloaded plus Agent-created retrieval plans. Defaults to 4. */
  maxOperatorDefinitions?: number;
}

export interface PiMemFailureDiagnostics {
  runId: string;
  scopeId: string;
  turns: number;
  toolCalls: number;
  lastAssistantText: string;
  candidates: PiMemResult["candidates"];
  evidence: PiMemResult["evidence"];
  trace: ToolTraceEntry[];
  operatorCatalog?: SearchOperatorCatalogIdentity;
  operatorDefinitions?: SearchOperatorDefinitionSnapshot[];
  providerFailureKind?: PiMemProviderFailureKind;
  providerResponseModel?: string;
  usage: ModelUsage;
}

export type PiMemProviderFailureKind =
  | "content_filter"
  | "http_error"
  | "invalid_finish_reason"
  | "invalid_json"
  | "invalid_response"
  | "model_substitution"
  | "request_timeout"
  | "transport_error"
  | "unknown";

export type PiMemFailureCode =
  | "tool_protocol_exhausted"
  | "run_timeout"
  | "turn_budget_exhausted"
  | "tool_budget_exhausted"
  | "provider_error"
  | "runtime_error";

export class PiMemRunError extends Error {
  readonly code: PiMemFailureCode;
  readonly diagnostics: PiMemFailureDiagnostics;

  constructor(
    message: string,
    diagnostics: PiMemFailureDiagnostics,
    code: PiMemFailureCode = "runtime_error",
  ) {
    super(message);
    this.name = "PiMemRunError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

const MAX_FINISH_FAILURES = 2;

function providerFailureKind(message: string): PiMemProviderFailureKind {
  if (/content_filter/iu.test(message)) return "content_filter";
  if (/invalid finish_reason/iu.test(message)) return "invalid_finish_reason";
  if (/substituted model/iu.test(message)) return "model_substitution";
  if (/invalid JSON/iu.test(message)) return "invalid_json";
  if (/(?:contains no (?:choices|message)|invalid .*response)/iu.test(message)) {
    return "invalid_response";
  }
  if (/(?:timed?\s*out|timeout|ETIMEDOUT)/iu.test(message)) {
    return "request_timeout";
  }
  if (/\bHTTP(?:\s+error)?\s*[:=]?\s*\d{3}\b/iu.test(message)) {
    return "http_error";
  }
  if (/(?:fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|EAI_AGAIN)/iu.test(message)) {
    return "transport_error";
  }
  return "unknown";
}

function providerResponseModel(message: string): string | undefined {
  return message.match(
    /^Provider substituted model ([a-zA-Z0-9._:/-]{1,128}); expected /u,
  )?.[1];
}

function questionPrompt(question: string, questionDate?: string): string {
  return [
    "Question:",
    question,
    ...(questionDate === undefined
      ? []
      : ["", `Question date (source timezone unspecified): ${questionDate}`]),
    "",
      "Use the available memory operations to find and read direct source " +
      "evidence. Keep workingMemory current. For an open set, use honest " +
      "frontier saturation rather than claiming ground-truth completeness. " +
      "After observing the final search or read result, call finish alone in a " +
      "later assistant turn with status and a source-grounded evidenceSummary. " +
      "Every exact source returned by read enters the final source package. " +
      "Do not answer the question.",
  ].join("\n");
}

/**
 * Runs one fresh Pi Agent per question. The accepted finish tool call is a
 * cited evidence package; free-form assistant text is never treated as output.
 */
export async function runPiMem(
  options: RunPiMemOptions,
): Promise<PiMemResult> {
  const scopeId = assertNonEmpty(options.scopeId, "scopeId");
  const question = assertNonEmpty(options.question, "question");
  const runId = newRunId();
  const ledger = new MemoryLedger(scopeId);
  const trace: ToolTraceEntry[] = [];
  const callArgs = new Map<string, unknown>();
  const maxTurns = options.maxTurns ?? 16;
  const maxToolCalls = options.maxToolCalls ?? 40;
  const maxProtocolNudges = options.maxProtocolNudges ?? 2;
  const maxRunMs = options.maxRunMs ?? 120_000;
  let turns = 0;
  let toolCalls = 0;
  let finishFailures = 0;
  let finishFailureMessage: string | undefined;
  let budgetFailure:
    | {
      code: "turn_budget_exhausted" | "tool_budget_exhausted";
      message: string;
    }
    | undefined;
  const finishCallsTerminatedByGuard = new Set<string>();
  let timedOut = false;
  const retrieval = options.store.getRetrievalMetadata?.() ?? {
    retrievalProfile: "fts5" as const,
  };
  const zeroRetrievalMetrics: RetrievalMetricsSnapshot = {
    embeddingCalls: 0,
    embeddingLatencyMs: 0,
    denseCandidateCount: 0,
    rerankCandidateCount: 0,
    denseFallbackCount: 0,
  };
  const retrievalMetricsBefore =
    options.store.snapshotRetrievalMetrics?.() ?? zeroRetrievalMetrics;
  const ephemeralContext = createEphemeralMemoryContext();
  const operatorCatalog = options.operatorRegistry.forkForRun(
    options.maxOperatorDefinitions ?? 4,
  );
  for (const definition of options.operatorDefinitions ?? []) {
    operatorCatalog.define(structuredClone(definition));
  }
  const tools = createPiMemTools({
    store: options.store,
    operatorRegistry: operatorCatalog,
    operatorDefinitions: operatorCatalog,
    scopeId,
    ledger,
    question,
    ...(options.questionDate === undefined
      ? {}
      : { questionDate: options.questionDate }),
    searchDefaults: {
      limit: 20,
      order: "relevance",
    },
    ...(options.maxSearchCalls === undefined
      ? {}
      : { maxSearchCalls: options.maxSearchCalls }),
    ...(options.readOnlyNavigation === undefined
      ? {}
      : {
          bashRo: {
            ...options.readOnlyNavigation,
            store: options.store,
          },
        }),

  });
  const enforceToolProtocol = createToolProtocolBeforeToolCall();
  const agent = new Agent({
    initialState: {
      systemPrompt: piMemSystemPrompt(
        options.skill ?? "pimem-v0",
        options.systemPrompt ?? PI_MEM_TOOL_SYSTEM_PROMPT,
        operatorCatalog.list(),
      ),
      model: options.modelRuntime.model,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      tools: tools.all,
    },
    streamFn: options.modelRuntime.streamFn,
    getApiKey: options.modelRuntime.getApiKey,
    transformContext: ephemeralContext.transformContext,
    beforeToolCall: enforceToolProtocol,
    afterToolCall: async (context) => {
      if (
        context.toolCall.name === "finish" && context.isError &&
        finishFailures + 1 >= MAX_FINISH_FAILURES
      ) {
        finishCallsTerminatedByGuard.add(context.toolCall.id);
        return { terminate: true };
      }
      return undefined;
    },
    toolExecution: "sequential",
    sessionId: runId,
  });

  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      turns += 1;
      if (turns > maxTurns) {
        budgetFailure ??= {
          code: "turn_budget_exhausted",
          message: `PiMem exceeded the ${maxTurns}-turn budget`,
        };
        agent.abort();
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      toolCalls += 1;
      callArgs.set(event.toolCallId, event.args);
      if (toolCalls > maxToolCalls) {
        budgetFailure ??= {
          code: "tool_budget_exhausted",
          message: `PiMem exceeded the ${maxToolCalls}-tool-call budget`,
        };
        agent.abort();
      }
      return;
    }
    if (event.type === "tool_execution_end") {
      trace.push({
        step: trace.length + 1,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: callArgs.get(event.toolCallId),
        isError: event.isError,
        ...(
          event.result !== undefined &&
          typeof event.result === "object" &&
          event.result !== null &&
          "content" in event.result
            ? { content: event.result.content }
            : {}
        ),
        ...(
          event.result !== undefined &&
          typeof event.result === "object" &&
          event.result !== null &&
          "details" in event.result
            ? { details: event.result.details }
            : {}
        ),
      });
      if (event.toolName === "finish" && event.isError) {
        finishFailures += 1;
        if (finishFailures >= MAX_FINISH_FAILURES) {
          finishFailureMessage =
            `Protocol error: finish failed ${finishFailures} times; ` +
            "terminating instead of continuing an unbounded correction loop.";
          if (!finishCallsTerminatedByGuard.has(event.toolCallId)) {
            // Argument-schema failures bypass afterToolCall, so abort the active
            // loop here. The provider receives the already-aborted signal before
            // any attempted continuation.
            agent.abort();
          }
        }
      }
    }
  });

  const failure = (
    code: PiMemFailureCode,
    message: string,
  ): PiMemRunError => {
    const responseModel = code === "provider_error"
      ? providerResponseModel(message)
      : undefined;
    return new PiMemRunError(message, {
      runId,
      scopeId,
      turns,
      toolCalls,
      lastAssistantText: assistantMessageText(
        lastAssistantMessage(agent.state.messages),
        4_000,
      ),
      candidates: ledger.candidates,
      evidence: ledger.inspectedEvidence,
      trace: [...trace],
      operatorCatalog: operatorCatalog.identity(),
      operatorDefinitions: operatorCatalog.snapshots(),
      ...(code === "provider_error"
        ? {
            providerFailureKind: providerFailureKind(message),
            ...(responseModel === undefined
              ? {}
              : { providerResponseModel: responseModel }),
          }
        : {}),
      usage: aggregateAssistantUsage(agent.state.messages),
    }, code);
  };

  const guardFailure = (): PiMemRunError | undefined => {
    if (timedOut) {
      return failure(
        "run_timeout",
        `PiMem exceeded the ${maxRunMs}ms run limit`,
      );
    }
    if (budgetFailure !== undefined) {
      return failure(budgetFailure.code, budgetFailure.message);
    }
    if (finishFailureMessage !== undefined) {
      return failure("tool_protocol_exhausted", finishFailureMessage);
    }
    return undefined;
  };

  const runTimer = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, maxRunMs);
  runTimer.unref();
  try {
    try {
      await agent.prompt(questionPrompt(question, options.questionDate));
    } catch (error) {
      throw guardFailure() ?? failure(
        "runtime_error",
        error instanceof Error ? error.message : String(error),
      );
    }
    for (let nudge = 0; ledger.selection === undefined; nudge += 1) {
      const stoppedByGuard = guardFailure();
      if (stoppedByGuard !== undefined) throw stoppedByGuard;
      const lastAssistant = lastAssistantMessage(agent.state.messages);
      if (
        lastAssistant?.stopReason === "error" ||
        lastAssistant?.stopReason === "aborted"
      ) {
        throw failure(
          lastAssistant.stopReason === "error"
            ? "provider_error"
            : "runtime_error",
          lastAssistant.errorMessage ??
            `PiMem agent stopped with ${lastAssistant.stopReason}`,
        );
      }
      if (agent.state.errorMessage) {
        throw failure("provider_error", agent.state.errorMessage);
      }
      if (nudge >= maxProtocolNudges) break;
      try {
        await agent.prompt(
          "Protocol reminder: do not answer the question. Continue retrieval " +
            "if a useful evidence need or frontier remains; otherwise call " +
            "finish as the only tool call in this turn, with an honest status " +
            "and compact source-grounded evidenceSummary. Read " +
            "the preceding search frontier or exact READ_RESULT before " +
            "finishing. Every source returned by read is committed; the harness " +
            "generates its citations and provenance.",
        );
      } catch (error) {
        throw guardFailure() ?? failure(
          "runtime_error",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } finally {
    clearTimeout(runTimer);
  }
  const stoppedByGuard = guardFailure();
  if (stoppedByGuard !== undefined) throw stoppedByGuard;

  const selection = ledger.selection;
  if (!selection) {
    const lastAssistant = lastAssistantMessage(agent.state.messages);
    throw failure(
      "tool_protocol_exhausted",
      `Protocol error: PiMem stopped without calling finish ` +
        `(turns=${turns}, tools=${toolCalls}, lastStopReason=${
          lastAssistant?.stopReason ?? "none"
        })`,
    );
  }
  const candidates = ledger.candidates;
  const evidenceById = new Map(
    ledger.inspectedEvidence.map((item) => [item.memoryId, item]),
  );
  const evidence = selection.citations.map((citation) => {
    const item = evidenceById.get(citation.memoryId);
    if (!item) {
      throw failure(
        "runtime_error",
        `Cited evidence disappeared: ${citation.memoryId}`,
      );
    }
    return item;
  });
  const retrievalMetricsAfter =
    options.store.snapshotRetrievalMetrics?.() ?? zeroRetrievalMetrics;
  const retrievalMetrics = {
    embeddingCalls: Math.max(
      0,
      retrievalMetricsAfter.embeddingCalls - retrievalMetricsBefore.embeddingCalls,
    ),
    embeddingLatencyMs: Math.max(
      0,
      retrievalMetricsAfter.embeddingLatencyMs -
        retrievalMetricsBefore.embeddingLatencyMs,
    ),
    denseCandidateCount: Math.max(
      0,
      retrievalMetricsAfter.denseCandidateCount -
        retrievalMetricsBefore.denseCandidateCount,
    ),
    rerankCandidateCount: Math.max(
      0,
      retrievalMetricsAfter.rerankCandidateCount -
        retrievalMetricsBefore.rerankCandidateCount,
    ),
    denseFallbackCount: Math.max(
      0,
      retrievalMetricsAfter.denseFallbackCount -
        retrievalMetricsBefore.denseFallbackCount,
    ),
  };
  const responseModels = validateResponseModels(
    agent.state.messages,
    options.modelRuntime.modelId,
  );
  const base: PiMemResult = {
    runId,
    scopeId,
    question,
    status: selection.status,
    citations: selection.citations,
    evidenceSummary: selection.evidenceSummary,
    ...(selection.count === undefined ? {} : { count: selection.count }),
    ...(selection.inventory === undefined
      ? {}
      : { inventory: selection.inventory }),
    candidates,
    evidence,
    trace,
    operatorCatalog: operatorCatalog.identity(),
    operatorDefinitions: operatorCatalog.snapshots(),
    metrics: {
      searchCalls: trace.filter(
        (item) => item.toolName === "search" && !item.isError,
      ).length,
      readCalls: trace.filter((item) => item.toolName === "read").length,
      bashCalls: trace.filter((item) => item.toolName === "bash_ro").length,
      operatorDefinitionCalls: trace.filter(
        (item) => item.toolName === "define_operator",
      ).length,
      candidateCount: candidates.length,
      inspectedEvidenceCount: ledger.inspectedEvidence.length,
      evidenceCount: evidence.length,
      citedCount: selection.citations.length,
      retrievalProfile: retrieval.retrievalProfile,
      ...retrievalMetrics,
      expiredNavigationResults:
        ephemeralContext.snapshot().expiredNavigationResults,
      compactedReadResults:
        ephemeralContext.snapshot().compactedReadResults,
    },
    retrieval,
    retrievalModel: {
      providerId: options.modelRuntime.providerId,
      modelId: options.modelRuntime.modelId,
      responseModels,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      transport: options.modelRuntime.transport,
    },
    usage: aggregateAssistantUsage(agent.state.messages),
  };
  return options.questionDate === undefined
    ? base
    : { ...base, questionDate: options.questionDate };
}
