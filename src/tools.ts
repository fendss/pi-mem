import {
  Type,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { buildAggregateOperatorResult } from "./aggregate-operator.js";
import type { ReadOnlyBash } from "./bash-ro.js";
import { MemoryLedger } from "./ledger.js";
import type { MemoryStore, StoreSearchHit } from "./store.js";
import { temporalAnnotation } from "./temporal.js";
import {
  buildTimelineOperatorResult,
  resolveTemporalQuestion,
  temporalAuxiliaryRequest,
} from "./timeline-operator.js";
import type {
  EvidenceOperator,
  EvidenceOperatorResult,
  EvidenceOperatorSearchContext,
  MemoryCandidate,
  MemoryRecord,
  PiMemSelection,
  SearchOrder,
  SearchRequest,
} from "./types.js";

export const SearchParameters = Type.Object({
  queries: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 8,
    description:
      "One or more focused query variants. Compose and sequence queries adaptively based on the evidence needed and the results already observed.",
  }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  withinCandidateRefs: Type.Optional(
    Type.Array(Type.Integer({ minimum: 1 }), {
      minItems: 1,
      maxItems: 100,
      description:
        "Optional candidate numbers whose source sessions should bound this search. Internal session IDs never need to be copied.",
    }),
  ),
  after: Type.Optional(Type.String({ minLength: 1 })),
  before: Type.Optional(Type.String({ minLength: 1 })),
  order: Type.Optional(Type.Union([
    Type.Literal("relevance"),
    Type.Literal("chronological"),
    Type.Literal("reverse-chronological"),
  ])),
  maxPerSession: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  operator: Type.Optional(Type.Union([
    Type.Literal("standard"),
    Type.Literal("timeline"),
    Type.Literal("aggregate"),
  ], {
    description:
      "Optional evidence operator. Timeline resolves and organizes time evidence; aggregate extracts, classifies, and deduplicates numeric evidence. When omitted, the tool infers the operator from the question.",
  })),
});

export const ReadParameters = Type.Object({
  candidateRefs: Type.Array(Type.Integer({ minimum: 0 }), {
    minItems: 1,
    maxItems: 100,
    description:
      "Stable candidate numbers returned by search or bash_ro. The harness resolves them to exact internal memory IDs. Zero is normalized to the first candidate for defensive compatibility with zero-based model output.",
  }),
  contextBefore: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  contextAfter: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
});

export const FinishParameters = Type.Object({
  status: Type.Union([
    Type.Literal("sufficient"),
    Type.Literal("insufficient"),
  ]),
  citations: Type.Array(
    Type.Object({
      candidateRef: Type.Integer({ minimum: 0 }),
      supports: Type.String({ minLength: 1 }),
    }),
  ),
  evidenceSummary: Type.String({ minLength: 1 }),
  count: Type.Optional(Type.Integer({
    minimum: 0,
    description:
      "Optional source-grounded aggregate count. Omit for non-count evidence.",
  })),
  inventory: Type.Optional(
    Type.Array(
      Type.Object({
        item: Type.String({ minLength: 1 }),
        candidateRefs: Type.Array(Type.Integer({ minimum: 0 }), {
          minItems: 1,
        }),
      }),
      {
        description:
          "Optional evidence ledger for an explicitly enumerated list. Do not fabricate one row per unnamed member of an aggregate count.",
      },
    ),
  ),
});

export const BashRoParameters = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 4096 }),
});

export interface SearchToolDetails {
  kind: "search";
  request: SearchRequest;
  auxiliaryRequest?: SearchRequest;
  operator: EvidenceOperator;
  operatorResult?: EvidenceOperatorResult;
  candidateReferences: Array<{ candidateRef: number; memoryId: string }>;
  candidates: MemoryCandidate[];
  databaseOperatorApplied: boolean;
  repeatedQueries?: string[];
}

export interface ReadToolDetails {
  kind: "read";
  requestedCandidateRefs: number[];
  requestedMemoryIds: string[];
  contextBefore: number;
  contextAfter: number;
  memories: MemoryRecord[];
  evidenceReferences: Array<{
    evidenceRef: number;
    candidateRef: number;
    memoryId: string;
  }>;
  expandedMemoryIds: string[];
  candidates: MemoryCandidate[];
}

export interface FinishToolDetails {
  kind: "finish";
  autoReadCandidateRefs: number[];
  autoReadMemoryIds: string[];
  selection: PiMemSelection;
}

export interface BashRoToolDetails {
  kind: "bash_ro";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
  memoryIds: string[];
  candidateReferences: Array<{ candidateRef: number; memoryId: string }>;
  candidates: MemoryCandidate[];
}

export interface MemoryToolStore {
  search(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): StoreSearchHit[] | Promise<StoreSearchHit[]>;
  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore?: number,
    contextAfter?: number,
  ): MemoryRecord[];
  expandEvidenceOperator?(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
  ): StoreSearchHit[] | Promise<StoreSearchHit[]>;
}

export interface CreatePiMemToolsOptions {
  store: MemoryToolStore;
  scopeId: string;
  ledger: MemoryLedger;
  bashRo?: {
    runner: ReadOnlyBash;
    scopePath: string;
    store: Pick<MemoryStore, "findMentionedMemoryIds" | "getRecords">;
  };
  beforeFinish?: (selection: PiMemSelection) => Promise<void> | void;
  question?: string;
  questionDate?: string;
  searchDefaults?: Pick<SearchRequest, "limit" | "order" | "maxPerSession">;
  searchGuidance?: string;
}

export interface PiMemTools {
  search: AgentTool<typeof SearchParameters, SearchToolDetails>;
  read: AgentTool<typeof ReadParameters, ReadToolDetails>;
  bashRo?: AgentTool<typeof BashRoParameters, BashRoToolDetails>;
  finish: AgentTool<typeof FinishParameters, FinishToolDetails>;
  all: AgentTool[];
}

export function createBashRoTool(
  options: CreatePiMemToolsOptions & {
    bashRo: NonNullable<CreatePiMemToolsOptions["bashRo"]>;
  },
): AgentTool<typeof BashRoParameters, BashRoToolDetails> {
  return {
    name: "bash_ro",
    label: "Explore raw memory",
    description:
      "Run grep/sed/awk/find or small Python scripts over this scope's sanitized raw-memory files. memory.jsonl fields include memoryId, timestamp, sessionId, turnIndex, role, and content; print memoryId for every relevant row. The container is read-only and has no network. Output is navigation only; call read before citing.",
    parameters: BashRoParameters,
    async execute(_toolCallId, params, signal) {
      const command = params.command.trim();
      const result = await options.bashRo.runner.run(
        options.bashRo.scopePath,
        command,
        signal,
      );
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      const memoryIds = options.bashRo.store.findMentionedMemoryIds(
        options.scopeId,
        combinedOutput,
      );
      const records = options.bashRo.store.getRecords(
        options.scopeId,
        memoryIds,
      );
      const candidates = options.ledger.recordBashDiscoveries(
        records,
        command,
      );
      const candidateReferences = candidates.map((candidate) => ({
        candidateRef: options.ledger.candidateRef(candidate.memoryId)!,
        memoryId: candidate.memoryId,
      }));
      const details: BashRoToolDetails = {
        kind: "bash_ro",
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        truncated: result.truncated,
        memoryIds,
        candidateReferences,
        candidates,
      };
      const visibleStdout = candidateReferences.reduce(
        (text, item) => text.replaceAll(
          item.memoryId,
          `[candidate:${String(item.candidateRef)}]`,
        ),
        result.stdout,
      );
      const visibleStderr = candidateReferences.reduce(
        (text, item) => text.replaceAll(
          item.memoryId,
          `[candidate:${String(item.candidateRef)}]`,
        ),
        result.stderr,
      );
      const visible = [
        visibleStdout || "(no stdout)",
        visibleStderr ? `stderr:\n${visibleStderr}` : "",
        result.truncated ? "[output truncated]" : "",
        `discovered_candidate_refs=${JSON.stringify(candidateReferences.map((item) => item.candidateRef))}`,
        `exit_code=${String(result.exitCode)}`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text: visible }],
        details,
      };
    },
  };
}

function normalizeHarnessRefs(refs: readonly number[]): number[] {
  return [...new Set(refs.map((ref) => ref === 0 ? 1 : ref))];
}

function normalizeStrings(values: readonly string[], label: string): string[] {
  const normalized = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) {
    throw new Error(`${label} must contain at least one non-empty value`);
  }
  return normalized;
}

function makeSearchRequest(
  params: {
    queries: string[];
    limit?: number;
    sessionIds?: string[];
    after?: string;
    before?: string;
    order?: SearchOrder;
    maxPerSession?: number;
  },
  defaults: Pick<SearchRequest, "limit" | "order" | "maxPerSession"> = {},
): SearchRequest {
  const request: SearchRequest = {
    queries: normalizeStrings(params.queries, "queries"),
    limit: params.limit ?? defaults.limit ?? 8,
    order: params.order ?? defaults.order ?? "relevance",
  };
  if (params.sessionIds !== undefined) {
    request.sessionIds = normalizeStrings(params.sessionIds, "sessionIds");
  }
  if (params.after !== undefined) request.after = params.after.trim();
  if (params.before !== undefined) request.before = params.before.trim();
  const maxPerSession = params.maxPerSession ?? defaults.maxPerSession;
  if (maxPerSession !== undefined) request.maxPerSession = maxPerSession;
  return request;
}

function searchQueryFingerprint(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function inferEvidenceOperator(question: string | undefined): EvidenceOperator {
  if (!question) return "standard";
  const normalized = question.normalize("NFKC").toLowerCase();
  if (
    /\b(?:how many|number of|total|sum|all|list|times did)\b/u.test(normalized) &&
    !/\b(?:days?|weeks?|months?|years?|ago|before|after|between|order|first|latest|current|initial)\b/u.test(normalized)
  ) {
    return "aggregate";
  }
  if (
    /\b(?:days?|weeks?|months?|years?|ago|yesterday|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|before|after|between|order|happened first|earliest|latest|most recent|current|currently|initial|when|date)\b/u.test(normalized)
  ) {
    return "timeline";
  }
  return "standard";
}

function mergeOperatorHits(
  preferred: readonly StoreSearchHit[],
  fallback: readonly StoreSearchHit[],
  limit: number,
): StoreSearchHit[] {
  const merged = new Map<string, StoreSearchHit>();
  for (const hit of [...preferred, ...fallback]) {
    if (!merged.has(hit.record.memoryId)) merged.set(hit.record.memoryId, hit);
    if (merged.size >= limit) break;
  }
  return [...merged.values()];
}

function temporalSuffix(
  timestamp: string | undefined,
  questionDate: string | undefined,
): string {
  const annotation = temporalAnnotation(timestamp, questionDate);
  return annotation ? ` (${annotation})` : "";
}

function renderEvidenceOperator(
  result: EvidenceOperatorResult | undefined,
  ledger: MemoryLedger,
): string {
  if (!result) return "";
  const heading = result.operator === "timeline"
    ? "Timeline evidence table:"
    : "Aggregate evidence table:";
  const rows = result.rows.slice(0, 16).map((row) => {
    const temporal = row.eventTime === undefined ? "" : ` | event_time=${row.eventTime}`;
    const mentions = row.mentionedDates === undefined
      ? ""
      : ` | mentioned_dates=${row.mentionedDates.join(",")}`;
    const numeric = row.value === undefined
      ? ""
      : ` | value=${String(row.value)} ${row.unit ?? ""} | value_kind=${row.valueKind ?? "unknown"} | occurrence_ref=candidate:${String(ledger.candidateRef(row.memoryId))}`;
    const candidateRef = ledger.candidateRef(row.memoryId);
    return `- [candidate:${String(candidateRef ?? "unavailable")}] | slot=${JSON.stringify(row.slot)}${temporal}${mentions}${numeric} | ${row.quote}`;
  });
  const plan = result.temporalPlan === undefined
    ? []
    : [`temporal_plan=${JSON.stringify(result.temporalPlan)}`];
  const derivedForAgent = result.derived === undefined
    ? undefined
    : Object.fromEntries(Object.entries(result.derived).map(([key, value]) => {
        if (key === "latestMemoryId" && typeof value === "string") {
          return ["latestCandidateRef", ledger.candidateRef(value)];
        }
        if (key === "includedMemoryIds" && Array.isArray(value)) {
          return ["includedCandidateRefs", value.map((memoryId) =>
            typeof memoryId === "string" ? ledger.candidateRef(memoryId) : undefined
          ).filter((item) => item !== undefined)];
        }
        if (key === "includedDedupeKeys" && Array.isArray(value)) {
          return ["includedOccurrenceCount", value.length];
        }
        return [key, value];
      }));
  const derived = derivedForAgent === undefined
    ? []
    : [`derived=${JSON.stringify(derivedForAgent)}`];
  return [
    heading,
    ...plan,
    ...rows,
    ...derived,
    `coverage=${JSON.stringify(result.coverage)}`,
  ].join("\n");
}

function renderCandidates(
  candidates: readonly MemoryCandidate[],
  ledger: MemoryLedger,
  questionDate?: string,
): string {
  if (candidates.length === 0) return "No memory candidates found.";
  const lines = candidates.map((candidate) => {
    const time = candidate.timestamp ? ` | session_time=${candidate.timestamp}` : "";
    const discovery = [...candidate.discoveries]
      .reverse()
      .find((item) => item.tool === "search" && item.query);
    const matched = discovery?.query === undefined
      ? ""
      : ` | matched_query=${JSON.stringify(discovery.query)} | rank=${String(discovery.rank ?? "unknown")}`;
    return `- [candidate:${String(ledger.candidateRef(candidate.memoryId))}]${time}${temporalSuffix(candidate.timestamp, questionDate)} | turn=${String(candidate.turnIndex)} | role=${candidate.role}${matched} | ${candidate.preview}`;
  });
  return [
    `candidate_refs=${JSON.stringify(candidates.map((candidate) => ledger.candidateRef(candidate.memoryId)))}`,
    ...lines,
  ].join("\n");
}

function renderMemories(
  memories: readonly MemoryRecord[],
  ledger: MemoryLedger,
  questionDate?: string,
): string {
  return memories
    .map((memory) => {
      const time = memory.timestamp ? ` ${memory.timestamp}` : "";
      return `[candidate:${String(ledger.candidateRef(memory.memoryId))}; read:true]${time}${temporalSuffix(memory.timestamp, questionDate)} ${memory.role}\n${memory.content}`;
    })
    .join("\n\n");
}

export function createSearchTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["search"] {
  const seenQueryFingerprints = new Set<string>();
  return {
    name: "search",
    label: "Search memory",
    description:
      "Locate candidate memories with focused query variants. The harness automatically applies database-backed timeline or aggregate expansion when appropriate. Results use stable candidate numbers; pass those numbers to read and never construct internal memory IDs. Timeline resolves dates and orders source facts. Aggregate retrieves indexed numeric facts, classifies values, deduplicates occurrences, and reports a traceable derived value when unambiguous. Every discovered source remains in the internal provenance ledger; previews remain ephemeral.",
    parameters: SearchParameters,
    async execute(_toolCallId, params, signal) {
      const operator = params.operator ?? inferEvidenceOperator(options.question);
      const sessionIds = params.withinCandidateRefs === undefined
        ? undefined
        : [...new Set(options.ledger.selectCandidates(
            options.ledger.resolveCandidateRefs(params.withinCandidateRefs),
          ).map((candidate) => candidate.sessionId))];
      const request = makeSearchRequest(
        {
          queries: params.queries,
          ...(params.limit === undefined ? {} : { limit: params.limit }),
          ...(sessionIds === undefined ? {} : { sessionIds }),
          ...(params.after === undefined ? {} : { after: params.after }),
          ...(params.before === undefined ? {} : { before: params.before }),
          ...(params.order === undefined ? {} : { order: params.order }),
          ...(params.maxPerSession === undefined ? {} : { maxPerSession: params.maxPerSession }),
        },
        options.searchDefaults,
      );
      const repeatedQueries = request.queries.filter((query) =>
        seenQueryFingerprints.has(searchQueryFingerprint(query))
      );
      for (const query of request.queries) {
        seenQueryFingerprints.add(searchQueryFingerprint(query));
      }
      const primaryHits = await options.store.search(options.scopeId, request, signal);
      const question = options.question ?? request.queries.join(" ");
      const temporalPlan = operator === "timeline"
        ? resolveTemporalQuestion(question, options.questionDate)
        : undefined;
      const limit = request.limit ?? options.searchDefaults?.limit ?? 8;
      const databaseContext: EvidenceOperatorSearchContext | undefined = operator === "standard"
        ? undefined
        : {
            operator,
            question,
            ...(options.questionDate === undefined ? {} : { questionDate: options.questionDate }),
            targetDates: temporalPlan?.targets.map((target) => target.date) ?? [],
            maxCandidates: Math.min(100, Math.max(limit, operator === "aggregate" ? 80 : 60)),
          };
      const auxiliaryRequest = temporalPlan === undefined
        ? undefined
        : temporalAuxiliaryRequest(request, temporalPlan);
      const auxiliaryHits = auxiliaryRequest === undefined
        ? []
        : await options.store.search(options.scopeId, auxiliaryRequest, signal);
      const operatorSeeds = auxiliaryHits.length === 0
        ? primaryHits
        : mergeOperatorHits(
            auxiliaryHits,
            primaryHits,
            Math.min(100, auxiliaryHits.length + primaryHits.length),
          );
      const databaseHits = databaseContext === undefined || options.store.expandEvidenceOperator === undefined
        ? []
        : await options.store.expandEvidenceOperator(
            options.scopeId,
            request,
            databaseContext,
            operatorSeeds,
          );
      const databaseOperatorApplied = databaseContext !== undefined &&
        options.store.expandEvidenceOperator !== undefined;
      const preferredHits = databaseOperatorApplied ? databaseHits : auxiliaryHits;
      const hitLimit = operator === "standard"
        ? limit
        : Math.min(100, Math.max(limit, preferredHits.length));
      const hits = preferredHits.length === 0
        ? primaryHits
        : mergeOperatorHits(preferredHits, primaryHits, hitLimit);
      const candidates = options.ledger.recordSearchHits(hits);
      const operatorResult = operator === "timeline"
        ? buildTimelineOperatorResult(
            hits,
            question,
            options.questionDate,
            auxiliaryRequest,
          )
        : operator === "aggregate"
          ? buildAggregateOperatorResult(hits)
          : undefined;
      const candidateReferences = candidates.map((candidate) => ({
        candidateRef: options.ledger.candidateRef(candidate.memoryId)!,
        memoryId: candidate.memoryId,
      }));
      const details: SearchToolDetails = {
        kind: "search",
        request,
        ...(auxiliaryRequest === undefined ? {} : { auxiliaryRequest }),
        operator,
        ...(operatorResult === undefined ? {} : { operatorResult }),
        candidateReferences,
        candidates,
        databaseOperatorApplied,
        ...(repeatedQueries.length === 0 ? {} : { repeatedQueries }),
      };
      const rendered = [
        renderEvidenceOperator(operatorResult, options.ledger),
        renderCandidates(candidates, options.ledger, options.questionDate),
      ].filter(Boolean).join("\n");
      return {
        content: [{
          type: "text",
          text: options.searchGuidance
            ? `${options.searchGuidance}\n${rendered}`
            : rendered,
        }],
        details,
      };
    },
  };
}

export function createReadTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["read"] {
  return {
    name: "read",
    label: "Read memory",
    description:
      "Read selected immutable source memories using candidate numbers returned by search or bash_ro. The harness resolves them to exact internal IDs and records all context expansion. When a hit may omit its value, date, state, or adjacent reply, use bounded contextBefore/contextAfter. Use the same candidate numbers for citations in finish; there is no second evidence-number namespace.",
    parameters: ReadParameters,
    async execute(_toolCallId, params) {
      const candidateRefs = normalizeHarnessRefs(params.candidateRefs);
      const memoryIds = options.ledger.resolveCandidateRefs(candidateRefs);
      const contextBefore = params.contextBefore ?? 0;
      const contextAfter = params.contextAfter ?? 0;
      const memories = options.store.read(
        options.scopeId,
        memoryIds,
        contextBefore,
        contextAfter,
      );
      const recorded = options.ledger.recordRead(memories);
      const requested = new Set(memoryIds);
      const expandedMemoryIds = recorded
        .map((memory) => memory.memoryId)
        .filter((memoryId) => !requested.has(memoryId));
      const candidates = options.ledger.selectCandidates(
        recorded.map((memory) => memory.memoryId),
      );
      const evidenceReferences = recorded.map((memory) => ({
        evidenceRef: options.ledger.evidenceRef(memory.memoryId)!,
        candidateRef: options.ledger.candidateRef(memory.memoryId)!,
        memoryId: memory.memoryId,
      }));
      const details: ReadToolDetails = {
        kind: "read",
        requestedCandidateRefs: candidateRefs,
        requestedMemoryIds: memoryIds,
        contextBefore,
        contextAfter,
        memories: recorded,
        evidenceReferences,
        expandedMemoryIds,
        candidates,
      };
      return {
        content: [{
          type: "text",
          text: renderMemories(recorded, options.ledger, options.questionDate),
        }],
        details,
      };
    },
  };
}

export function createFinishTool(
  options: CreatePiMemToolsOptions,
): PiMemTools["finish"] {
  return {
    name: "finish",
    label: "Finish",
    description:
      "Submit a compact evidence package. Cite candidate numbers returned by search/read; the harness converts them to exact source IDs and deterministically auto-reads any selected candidate not already durable, then enforces provenance. Mark sufficient only when every required subclaim is supported. Use count only for a source-grounded aggregate and inventory only for explicitly enumerated supported items. Do not generate the benchmark answer.",
    parameters: FinishParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const submitted: PiMemSelection = {
        status: params.status,
        citations: params.citations.map((citation) => ({
          memoryId: options.ledger.resolveCandidateRefs(
            normalizeHarnessRefs([citation.candidateRef]),
          )[0]!,
          supports: citation.supports,
        })),
        evidenceSummary: params.evidenceSummary,
        ...(params.count === undefined ? {} : { count: params.count }),
        ...(params.inventory === undefined
          ? {}
          : {
              inventory: params.inventory.map((item) => ({
                item: item.item,
                memoryIds: options.ledger.resolveCandidateRefs(
                  normalizeHarnessRefs(item.candidateRefs),
                ),
              })),
            }),
      };
      await options.beforeFinish?.(submitted);
      const selectedMemoryIds = [...new Set([
        ...submitted.citations.map((citation) => citation.memoryId),
        ...(submitted.inventory ?? []).flatMap((item) => item.memoryIds),
      ])];
      const autoReadMemoryIds = selectedMemoryIds.filter((memoryId) =>
        !options.ledger.hasRead(memoryId)
      );
      const autoReadCandidateRefs = autoReadMemoryIds.map((memoryId) =>
        options.ledger.candidateRef(memoryId)!
      );
      if (autoReadMemoryIds.length > 0) {
        const autoReadRecords = options.store.read(
          options.scopeId,
          autoReadMemoryIds,
          0,
          0,
        );
        options.ledger.recordRead(autoReadRecords);
      }
      const selection = options.ledger.acceptSelection(submitted);
      const details: FinishToolDetails = {
        kind: "finish",
        autoReadCandidateRefs,
        autoReadMemoryIds,
        selection,
      };
      return {
        content: [{ type: "text", text: "Evidence selection accepted." }],
        details,
        terminate: true,
      };
    },
  };
}

export function createPiMemTools(
  options: CreatePiMemToolsOptions,
): PiMemTools {
  if (options.scopeId !== options.ledger.scopeId) {
    throw new Error(
      `Tool scope ${options.scopeId} does not match ledger scope ${options.ledger.scopeId}`,
    );
  }
  const search = createSearchTool(options);
  const read = createReadTool(options);
  const bashRo =
    options.bashRo === undefined
      ? undefined
      : createBashRoTool({
          ...options,
          bashRo: options.bashRo,
        });
  const finish = createFinishTool(options);
  return bashRo === undefined
    ? { search, read, finish, all: [search, read, finish] }
    : {
        search,
        read,
        bashRo,
        finish,
        all: [search, read, bashRo, finish],
      };
}

/**
 * Returns an error message when finish occurs in a multi-tool assistant turn.
 */
export function validateFinishToolBatch(
  toolNames: readonly string[],
  finishToolName = "finish",
): string | undefined {
  if (!toolNames.includes(finishToolName)) return undefined;
  if (toolNames.length === 1 && toolNames[0] === finishToolName) {
    return undefined;
  }
  return `${finishToolName} must be the only tool call in its turn`;
}

/**
 * Core-compatible beforeToolCall hook. A sequential batch may read/search and
 * then finish as its final call; the harness safely applies those side effects
 * in order. If finish appears earlier, only finish is deferred while the other
 * navigation calls remain usable.
 */
export function createFinishOnlyBeforeToolCall(
  finishToolName = "finish",
): (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined> {
  return async (context) => {
    const toolNames = context.assistantMessage.content
      .filter(
        (
          block,
        ): block is Extract<
          AssistantMessage["content"][number],
          { type: "toolCall" }
        > => block.type === "toolCall",
      )
      .map((call) => call.name);
    const finishIndexes = toolNames
      .map((name, index) => name === finishToolName ? index : -1)
      .filter((index) => index >= 0);
    if (finishIndexes.length === 0) return undefined;
    if (
      finishIndexes.length === 1 &&
      finishIndexes[0] === toolNames.length - 1
    ) {
      return undefined;
    }
    if (context.toolCall.name !== finishToolName) return undefined;
    return {
      block: true,
      reason: `${finishToolName} must be the final tool call in its turn`,
    };
  };
}
