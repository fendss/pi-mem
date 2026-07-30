import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ReadOnlyBash } from "./bash-ro.js";
import { createEphemeralMemoryContext } from "./context.js";
import { MemoryLedger } from "./ledger.js";
import type { PiModelRuntime } from "./model.js";
import {
  PIMEM_RETRIEVAL_SKILL,
  PIMEM_RETRIEVAL_SKILL_VERSION,
} from "./retrieval-skill.js";
import type { MemoryStore } from "./store.js";
import {
  createFinishOnlyBeforeToolCall,
  createPiMemTools,
  type MemoryToolStore,
} from "./tools.js";
import type {
  MemoryCandidate,
  PiMemResult,
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  ToolTraceEntry,
} from "./types.js";
import { assertNonEmpty, newRunId } from "./util.js";

export const PIMEM_HARNESS_VERSION = PIMEM_RETRIEVAL_SKILL_VERSION;

export const PI_MEM_SYSTEM_PROMPT = `You are PiMem: a memory retrieval and evidence-selection agent.

Your only task is to locate immutable source memories relevant to the caller's question and return a compact cited evidence package. Do not generate or format the benchmark answer. Different callers apply different answer protocols after retrieval.

Evidence policy:
- Match question typos to the exact intended entity while treating merely similar entities as distractors.
- Select direct source observations for every required subclaim.
- Preserve exact names, titles, places, labels, values, source roles, and timestamps in the evidence summary.
- Reconstruct temporal or update chains when the requested slot depends on order.
- If a required entity or component remains unsupported after focused searches, mark the package insufficient rather than guessing or substituting zero.

Tool policy:
- search previews are ephemeral navigation. They remain in the audit trace but expire from active model context after one turn.
- read only selected evidence. Every cited memory must be read.
- bash_ro is a focused last resort for exact matching, not a mandatory full-scope scan. Its output is navigation and also expires.
- Call finish alone with status, concise evidenceSummary, and citations. Count and inventory are optional evidence metadata.

${PIMEM_RETRIEVAL_SKILL}`;

export function orderCandidatesForEvidenceAttention(
  candidates: readonly MemoryCandidate[],
): MemoryCandidate[] {
  return candidates
    .map((candidate, discoveryOrder) => ({ candidate, discoveryOrder }))
    .sort((left, right) => {
      const leftPriority = left.candidate.cited ? 0 : left.candidate.read ? 1 : 2;
      const rightPriority = right.candidate.cited ? 0 : right.candidate.read ? 1 : 2;
      return leftPriority - rightPriority || left.discoveryOrder - right.discoveryOrder;
    })
    .map(({ candidate }) => candidate);
}

export interface PiMemRuntimeStore extends MemoryToolStore,
  Pick<MemoryStore, "findMentionedMemoryIds" | "getRecords"> {
  getRetrievalMetadata?(): RetrievalMetadata;
  snapshotRetrievalMetrics?(): RetrievalMetricsSnapshot;
}

export interface RunPiMemOptions {
  store: PiMemRuntimeStore;
  modelRuntime: PiModelRuntime;
  scopeId: string;
  question: string;
  questionDate?: string;
  scopePath?: string;
  bashRunner?: ReadOnlyBash;
  maxTurns?: number;
  maxToolCalls?: number;
  maxProtocolNudges?: number;
  maxRunMs?: number;
  systemPrompt?: string;
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
    "Choose search operators from the retrieval skill based on the evidence need. Search adaptively for direct source coverage, verify every required evidence slot, and call finish with the cited evidence package. Do not answer the question.",
  ].join("\n");
}

function lastAssistantMessage(
  messages: readonly unknown[],
): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant"
    ) {
      return message as AssistantMessage;
    }
  }
  return undefined;
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter(
      (block): block is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .slice(0, 4_000);
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

  const tools = createPiMemTools({
    store: options.store,
    scopeId,
    ledger,
    question,
    ...(options.questionDate === undefined
      ? {}
      : { questionDate: options.questionDate }),
    searchDefaults: {
      limit: 20,
      order: "relevance",
      maxPerSession: 4,
    },
    ...(options.scopePath === undefined
      ? {}
      : {
          bashRo: {
            runner: options.bashRunner ?? new ReadOnlyBash(),
            scopePath: options.scopePath,
            store: options.store,
          },
        }),

  });
  const agent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt ?? PI_MEM_SYSTEM_PROMPT,
      model: options.modelRuntime.model,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      tools: tools.all,
    },
    streamFn: options.modelRuntime.streamFn,
    getApiKey: options.modelRuntime.getApiKey,
    transformContext: ephemeralContext.transformContext,
    beforeToolCall: createFinishOnlyBeforeToolCall(),
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
      lastAssistantText: assistantText(
        lastAssistantMessage(agent.state.messages),
      ),
      candidates: ledger.candidates,
      evidence: ledger.evidence,
      trace: [...trace],
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
  const exactCandidates = new Map(
    options.store
      .getRecords(scopeId, candidates.map((candidate) => candidate.memoryId))
      .map((record) => [record.memoryId, record]),
  );
  const searchedMemories = orderCandidatesForEvidenceAttention(candidates).map((candidate) => {
    const record = exactCandidates.get(candidate.memoryId);
    if (!record) {
      throw failure(`Candidate memory disappeared: ${candidate.memoryId}`);
    }
    return {
      ...record,
      discoveries: candidate.discoveries,
      read: candidate.read,
      cited: candidate.cited,
    };
  });
  const evidence = ledger.evidence;
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
    searchedMemories,
    evidence,
    trace,
    metrics: {
      searchCalls: trace.filter((item) => item.toolName === "search").length,
      readCalls: trace.filter((item) => item.toolName === "read").length,
      bashCalls: trace.filter((item) => item.toolName === "bash_ro").length,
      candidateCount: candidates.length,
      evidenceCount: evidence.length,
      citedCount: selection.citations.length,
      retrievalProfile: retrieval.retrievalProfile,
      ...retrievalMetrics,
      expiredNavigationResults:
        ephemeralContext.snapshot().expiredNavigationResults,
    },
    retrieval,
    retrievalModel: {
      providerId: options.modelRuntime.providerId,
      modelId: options.modelRuntime.modelId,
      thinkingLevel: options.modelRuntime.thinkingLevel,
    },
  };
  return options.questionDate === undefined
    ? base
    : { ...base, questionDate: options.questionDate };
}
