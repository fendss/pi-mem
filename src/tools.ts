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
import { buildTimelineOperatorResult } from "./timeline-operator.js";
import type {
  EvidenceOperatorResult,
  EvidenceOperatorSearchContext,
  MemoryCandidate,
  MemoryRecord,
  PiMemSelection,
  SearchOperator,
  SearchOrder,
  SearchRequest,
} from "./types.js";

export const SearchParameters = Type.Object({
  operator: Type.Optional(Type.Union([
    Type.Literal("hybrid"),
    Type.Literal("lexical"),
    Type.Literal("coverage"),
    Type.Literal("temporal"),
    Type.Literal("numeric"),
    Type.Literal("history"),
  ], {
    description: "Agent-selected retrieval operator. Defaults to hybrid. The harness never routes from question keywords.",
  })),
  queries: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 8,
    description: "Focused query variants or separate evidence needs.",
  }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
  operator: SearchOperator;
  operatorResult?: EvidenceOperatorResult;
  candidateReferences: Array<{ candidateRef: number; memoryId: string }>;
  candidates: MemoryCandidate[];
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
  searchLexical?(
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
    roles?: MemoryRecord["role"][];
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
  if (params.roles !== undefined) request.roles = [...new Set(params.roles)];
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

async function coverageHits(
  store: MemoryToolStore,
  scopeId: string,
  queries: readonly string[],
  limit: number,
  signal?: AbortSignal,
): Promise<StoreSearchHit[]> {
  const grouped = new Map<string, {
    hits: StoreSearchHit[];
    queries: Set<string>;
    score: number;
  }>();
  for (const query of queries) {
    const hits = await store.search(scopeId, {
      queries: [query],
      limit: Math.min(100, Math.max(20, limit * 2)),
      order: "relevance",
      maxPerSession: 4,
    }, signal);
    for (const hit of hits) {
      const entry = grouped.get(hit.record.sessionId) ?? {
        hits: [],
        queries: new Set<string>(),
        score: 0,
      };
      entry.hits.push(hit);
      entry.queries.add(query);
      entry.score += 1 / (60 + hit.rank);
      grouped.set(hit.record.sessionId, entry);
    }
  }
  const orderedSessions = [...grouped.entries()].sort((left, right) =>
    right[1].queries.size - left[1].queries.size ||
    right[1].score - left[1].score ||
    left[0].localeCompare(right[0])
  );
  const selected = new Map<string, StoreSearchHit>();
  for (const [, session] of orderedSessions) {
    let sessionCount = 0;
    for (const hit of session.hits.sort((left, right) =>
      left.rank - right.rank || left.record.turnIndex - right.record.turnIndex
    )) {
      if (selected.has(hit.record.memoryId)) continue;
      selected.set(hit.record.memoryId, hit);
      sessionCount += 1;
      if (selected.size >= limit) return [...selected.values()];
      if (sessionCount >= 4) break;
    }
  }
  return [...selected.values()];
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
  const heading = result.operator === "temporal"
    ? "Temporal evidence:"
    : "Numeric evidence:";
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
      "Run one Agent-selected retrieval operator with focused queries. Hybrid is broad recall; lexical is exact text; coverage aggregates independent queries across sessions; temporal joins date facts; numeric joins typed number facts; history returns user claims chronologically. The harness never routes from question keywords or accepts SQL. Use returned candidate numbers with read.",
    parameters: SearchParameters,
    async execute(_toolCallId, params, signal) {
      const operator: SearchOperator = params.operator ?? "hybrid";
      const limit = params.limit ?? options.searchDefaults?.limit ?? 20;
      let request = makeSearchRequest({
        queries: params.queries,
        limit,
        order: "relevance",
        maxPerSession: 4,
      });
      const repeatedQueries = request.queries.filter((query) =>
        seenQueryFingerprints.has(searchQueryFingerprint(query))
      );
      request.queries.forEach((query) =>
        seenQueryFingerprints.add(searchQueryFingerprint(query))
      );

      let hits: StoreSearchHit[];
      let operatorResult: EvidenceOperatorResult | undefined;
      if (operator === "lexical") {
        hits = options.store.searchLexical === undefined
          ? await options.store.search(options.scopeId, request, signal)
          : await options.store.searchLexical(options.scopeId, request, signal);
      } else if (operator === "coverage") {
        request = makeSearchRequest({
          queries: request.queries,
          limit: Math.max(40, limit),
          order: "relevance",
          maxPerSession: 4,
        });
        hits = await coverageHits(
          options.store,
          options.scopeId,
          request.queries,
          request.limit ?? 40,
          signal,
        );
      } else if (operator === "history") {
        request = makeSearchRequest({
          queries: request.queries,
          limit: Math.max(40, limit),
          roles: ["user"],
          order: "chronological",
          maxPerSession: 4,
        });
        hits = await options.store.search(options.scopeId, request, signal);
      } else if (operator === "temporal" || operator === "numeric") {
        const primaryHits = await options.store.search(options.scopeId, request, signal);
        const maxCandidates = operator === "temporal" ? 60 : 80;
        const context: EvidenceOperatorSearchContext = {
          operator,
          maxCandidates,
        };
        const databaseHits = options.store.expandEvidenceOperator === undefined
          ? []
          : await options.store.expandEvidenceOperator(
              options.scopeId,
              request,
              context,
              primaryHits,
            );
        hits = databaseHits.length === 0
          ? primaryHits
          : mergeOperatorHits(databaseHits, primaryHits, maxCandidates);
        operatorResult = operator === "temporal"
          ? buildTimelineOperatorResult(
              databaseHits.length === 0 ? primaryHits : databaseHits,
              request.queries.join(" "),
              options.questionDate,
            )
          : buildAggregateOperatorResult(databaseHits);
      } else {
        hits = await options.store.search(options.scopeId, request, signal);
      }

      const candidates = options.ledger.recordSearchHits(hits);
      const candidateReferences = candidates.map((candidate) => ({
        candidateRef: options.ledger.candidateRef(candidate.memoryId)!,
        memoryId: candidate.memoryId,
      }));
      const details: SearchToolDetails = {
        kind: "search",
        request,
        operator,
        ...(operatorResult === undefined ? {} : { operatorResult }),
        candidateReferences,
        candidates,
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
      if (options.ledger.candidates.length === 0) {
        return {
          content: [{ type: "text", text: "No candidates exist. Call search again; do not guess a candidate number." }],
          details: {
            kind: "read",
            requestedCandidateRefs: candidateRefs,
            requestedMemoryIds: [],
            contextBefore: params.contextBefore ?? 0,
            contextAfter: params.contextAfter ?? 0,
            memories: [],
            evidenceReferences: [],
            expandedMemoryIds: [],
            candidates: [],
          },
        };
      }
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
