import { Agent } from "@earendil-works/pi-agent-core";
import { createEphemeralMemoryContext } from "./adapters/pi/ephemeral-context.js";
import {
  aggregateAssistantUsage,
  assistantMessageText,
  lastAssistantMessage,
  validateResponseModels,
} from "./adapters/pi/assistant-messages.js";
import {
  PI_MEM_BASE_SYSTEM_PROMPT,
  piMemSystemPrompt,
  type PiMemSkill,
} from "./adapters/pi/retrieval-prompt.js";
import { MemoryLedger } from "./model/memory-ledger.js";
import type { PiModelRuntime } from "../platform/pi/load-model-runtime.js";
import {
  createToolProtocolBeforeToolCall,
  createPiMemTools,
  type MemoryToolStore,
} from "./adapters/pi/tools.js";
import type {
  ModelUsage,
  PiMemResult,
  ToolTraceEntry,
} from "./model/evidence.js";
import type {
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchOperatorCatalogIdentity,
  SearchOperatorDefinition,
  SearchOperatorDefinitionSnapshot,
  SearchOperatorRegistry,
} from "../retrieval/index.js";
import type { MemoryRecord } from "../memory/index.js";
import { assertNonEmpty, newRunId } from "../util.js";
import type { ReadOnlyNavigationBinding } from "./ports/read-only-navigation.js";

export const PIMEM_HARNESS_VERSION = "pimem-declarative-operators-v1";

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
  /** Total preloaded plus Agent-created operators. Defaults to 2. */
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
  usage: ModelUsage;
}

export class PiMemRunError extends Error {
  readonly diagnostics: PiMemFailureDiagnostics;

  constructor(message: string, diagnostics: PiMemFailureDiagnostics) {
    super(message);
    this.name = "PiMemRunError";
    this.diagnostics = diagnostics;
  }
}

function questionPrompt(question: string, questionDate?: string): string {
  return [
    "Question:",
    question,
    ...(questionDate === undefined
      ? []
      : ["", `Question date (source timezone unspecified): ${questionDate}`]),
    "",
    "Use the available memory operations to find direct source coverage, verify every required evidence slot, and call finish with the cited evidence package. Do not answer the question.",
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
  let timedOut = false;
  const retrieval = options.store.getRetrievalMetadata?.() ?? {
    retrievalProfile: "fts5" as const,
  };
  const zeroRetrievalMetrics: RetrievalMetricsSnapshot = {
    embeddingCalls: 0,
    embeddingLatencyMs: 0,
    denseCandidateCount: 0,
    rerankCandidateCount: 0,
  };
  const retrievalMetricsBefore =
    options.store.snapshotRetrievalMetrics?.() ?? zeroRetrievalMetrics;
  const ephemeralContext = createEphemeralMemoryContext();
  const operatorCatalog = options.operatorRegistry.forkForRun(
    options.maxOperatorDefinitions ?? 2,
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
      : {
          searchGuidance:
            `This run permits at most ${options.maxSearchCalls} search calls. ` +
            "After the budget is exhausted, read the best existing candidates and finish.",
        }),
    ...(options.readOnlyNavigation === undefined
      ? {}
      : {
          bashRo: {
            ...options.readOnlyNavigation,
            store: options.store,
          },
        }),

  });
  const enforceToolProtocol = createToolProtocolBeforeToolCall({
    ...(options.maxSearchCalls === undefined
      ? {}
      : { maxSearchCalls: options.maxSearchCalls }),
  });
  const agent = new Agent({
    initialState: {
      systemPrompt: piMemSystemPrompt(
        options.skill ?? "pimem-v0",
        options.systemPrompt ?? PI_MEM_BASE_SYSTEM_PROMPT,
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
    toolExecution: "sequential",
    sessionId: runId,
  });

  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      turns += 1;
      if (turns > maxTurns) agent.abort();
      return;
    }
    if (event.type === "tool_execution_start") {
      toolCalls += 1;
      callArgs.set(event.toolCallId, event.args);
      if (toolCalls > maxToolCalls) agent.abort();
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
    }
  });

  const failure = (message: string): PiMemRunError =>
    new PiMemRunError(message, {
      runId,
      scopeId,
      turns,
      toolCalls,
      lastAssistantText: assistantMessageText(
        lastAssistantMessage(agent.state.messages),
        4_000,
      ),
      candidates: ledger.candidates,
      evidence: ledger.evidence,
      trace: [...trace],
      operatorCatalog: operatorCatalog.identity(),
      operatorDefinitions: operatorCatalog.snapshots(),
      usage: aggregateAssistantUsage(agent.state.messages),
    });

  const runTimer = setTimeout(() => {
    timedOut = true;
    agent.abort();
  }, maxRunMs);
  runTimer.unref();
  try {
    try {
      await agent.prompt(questionPrompt(question, options.questionDate));
    } catch (error) {
      throw failure(error instanceof Error ? error.message : String(error));
    }
    for (let nudge = 0; ledger.selection === undefined; nudge += 1) {
      const lastAssistant = lastAssistantMessage(agent.state.messages);
      if (timedOut) {
        throw failure(`PiMem exceeded the ${maxRunMs}ms run limit`);
      }
      if (
        lastAssistant?.stopReason === "error" ||
        lastAssistant?.stopReason === "aborted"
      ) {
        throw failure(
          lastAssistant.errorMessage ??
            `PiMem agent stopped with ${lastAssistant.stopReason}`,
        );
      }
      if (agent.state.errorMessage) {
        throw failure(agent.state.errorMessage);
      }
      if (nudge >= maxProtocolNudges) break;
      try {
        await agent.prompt(
          "Protocol reminder: do not answer the question. Continue retrieval if evidence coverage is incomplete; otherwise call finish alone now with sufficient or insufficient status, evidenceSummary, and valid citations.",
        );
      } catch (error) {
        throw failure(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    clearTimeout(runTimer);
  }
  if (timedOut) {
    throw failure(`PiMem exceeded the ${maxRunMs}ms run limit`);
  }

  const selection = ledger.selection;
  if (!selection) {
    const lastAssistant = lastAssistantMessage(agent.state.messages);
    throw failure(
      `Protocol error: PiMem stopped without calling finish ` +
        `(turns=${turns}, tools=${toolCalls}, lastStopReason=${
          lastAssistant?.stopReason ?? "none"
        })`,
    );
  }
  const candidates = ledger.candidates;
  const evidenceById = new Map(
    ledger.evidence.map((item) => [item.memoryId, item]),
  );
  const evidence = selection.citations.map((citation) => {
    const item = evidenceById.get(citation.memoryId);
    if (!item) {
      throw failure(`Cited evidence disappeared: ${citation.memoryId}`);
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
      searchCalls: trace.filter((item) => item.toolName === "search").length,
      readCalls: trace.filter((item) => item.toolName === "read").length,
      bashCalls: trace.filter((item) => item.toolName === "bash_ro").length,
      operatorDefinitionCalls: trace.filter(
        (item) => item.toolName === "define_operator",
      ).length,
      candidateCount: candidates.length,
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
