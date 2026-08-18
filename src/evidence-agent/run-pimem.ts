import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ReadOnlyBash } from "./adapters/docker/read-only-shell.js";
import { createEphemeralMemoryContext } from "./adapters/pi/ephemeral-context.js";
import { MemoryLedger } from "./model/memory-ledger.js";
import type { PiModelRuntime } from "../platform/pi/load-model-runtime.js";
import {
  createFinishOnlyBeforeToolCall,
  createPiMemTools,
  type MemoryToolStore,
} from "./adapters/pi/tools.js";
import type {
  MemoryCandidate,
  PiMemResult,
  ToolTraceEntry,
} from "./model/evidence.js";
import type {
  RetrievalMetadata,
  RetrievalMetricsSnapshot,
  SearchOperatorCatalogEntry,
  SearchOperatorRegistry,
} from "../retrieval/index.js";
import { renderSearchOperatorCatalog } from "../retrieval/index.js";
import type { MemoryRecord } from "../memory/index.js";
import { assertNonEmpty, newRunId, sha256 } from "../util.js";

export type PiMemSkill = "none" | "pimem-v0";

export const PIMEM_HARNESS_VERSION = "pimem-operator-registry-v1";
export const PIMEM_SKILL_VERSION = "pimem-v0-registry-1";

const DEFAULT_SKILL_PATH = fileURLToPath(
  new URL("../../.agents/skills/pimem-retrieval/SKILL.md", import.meta.url),
);

export const PIMEM_SKILL_TEXT = readFileSync(DEFAULT_SKILL_PATH, "utf8");
export const PIMEM_SKILL_HASH = sha256(PIMEM_SKILL_TEXT);

const PI_MEM_BASE_SYSTEM_PROMPT = `You are PiMem: a memory retrieval and evidence-selection agent.

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
`;

function activeSkillPrompt(): string {
  return `<active_skill name="pimem-retrieval" version="${PIMEM_SKILL_VERSION}">\n${PIMEM_SKILL_TEXT}\n</active_skill>`;
}

export function piMemSystemPrompt(
  skill: PiMemSkill = "pimem-v0",
  basePrompt: string = PI_MEM_BASE_SYSTEM_PROMPT,
  operatorCatalog: readonly SearchOperatorCatalogEntry[] = [],
): string {
  const catalogPrompt = operatorCatalog.length === 0
    ? ""
    : `<search_operator_catalog>\n${renderSearchOperatorCatalog(operatorCatalog)}\n</search_operator_catalog>`;
  return [
    basePrompt,
    catalogPrompt,
    ...(skill === "none" ? [] : [activeSkillPrompt()]),
  ].filter(Boolean).join("\n\n");
}

export const PI_MEM_SYSTEM_PROMPT = piMemSystemPrompt();

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
  scopePath?: string;
  bashRunner?: ReadOnlyBash;
  maxTurns?: number;
  maxToolCalls?: number;
  maxProtocolNudges?: number;
  maxRunMs?: number;
  systemPrompt?: string;
  skill?: PiMemSkill;
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
    "Use the available memory operations to find direct source coverage, verify every required evidence slot, and call finish with the cited evidence package. Do not answer the question.",
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

function responseModelMatches(requested: string, actual: string): boolean {
  return actual === requested || actual.startsWith(`${requested}-`);
}

function validateResponseModels(
  messages: readonly unknown[],
  requestedModel: string,
): string[] {
  const responseModels = new Set<string>();
  for (const message of messages) {
    if (
      typeof message !== "object" || message === null ||
      !("role" in message) || message.role !== "assistant"
    ) continue;
    const assistant = message as AssistantMessage;
    const actual = assistant.responseModel ?? assistant.model;
    if (!responseModelMatches(requestedModel, actual)) {
      throw new Error(
        `Provider substituted model ${actual}; expected ${requestedModel}`,
      );
    }
    responseModels.add(actual);
  }
  if (responseModels.size === 0) {
    throw new Error("Provider response model is missing");
  }
  return [...responseModels].sort();
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
    operatorRegistry: options.operatorRegistry,
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
  const enforceFinishOnly = createFinishOnlyBeforeToolCall();
  const agent = new Agent({
    initialState: {
      systemPrompt: piMemSystemPrompt(
        options.skill ?? "pimem-v0",
        options.systemPrompt ?? PI_MEM_BASE_SYSTEM_PROMPT,
        options.operatorRegistry.list(),
      ),
      model: options.modelRuntime.model,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      tools: tools.all,
    },
    streamFn: options.modelRuntime.streamFn,
    getApiKey: options.modelRuntime.getApiKey,
    transformContext: ephemeralContext.transformContext,
    beforeToolCall: enforceFinishOnly,
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
      responseModels,
      thinkingLevel: options.modelRuntime.thinkingLevel,
      transport: options.modelRuntime.transport,
    },
  };
  return options.questionDate === undefined
    ? base
    : { ...base, questionDate: options.questionDate };
}
