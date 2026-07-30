export type MemoryRole = "user" | "assistant" | "system" | "other";

export interface MemoryTurnInput {
  id?: string;
  role: MemoryRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySessionInput {
  scopeId: string;
  sessionId: string;
  timestamp?: string;
  turns: MemoryTurnInput[];
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  memoryId: string;
  scopeId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  content: string;
  timestamp?: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export type SearchOrder =
  | "relevance"
  | "chronological"
  | "reverse-chronological";

export type SearchOperator =
  | "hybrid"
  | "lexical"
  | "coverage"
  | "temporal"
  | "numeric"
  | "history";

export interface EvidenceOperatorSearchContext {
  operator: "temporal" | "numeric";
  maxCandidates: number;
}

export type NumericValueKind =
  | "increment"
  | "cumulative"
  | "snapshot"
  | "target"
  | "unknown";

export interface EvidenceOperatorRow {
  slot: string;
  quote: string;
  memoryId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  eventTime?: string;
  mentionedDates?: string[];
  value?: number;
  unit?: string;
  valueKind?: NumericValueKind;
  dedupeKey?: string;
  rawValue?: string;
}

export interface EvidenceOperatorResult {
  version: "pimem-evidence-operators-v1";
  operator: "temporal" | "numeric";
  rows: EvidenceOperatorRow[];
  coverage: {
    candidateCount: number;
    distinctSessions: number;
    truncated: boolean;
  };
  temporalPlan?: {
    questionDate?: string;
    targets: Array<{
      expression: string;
      date: string;
      basis: "relative-to-question" | "explicit-in-question";
    }>;
    auxiliaryWindowApplied: boolean;
  };
  derived?: Record<string, unknown>;
}

export interface SearchRequest {
  queries: string[];
  limit?: number;
  sessionIds?: string[];
  roles?: MemoryRole[];
  after?: string;
  before?: string;
  order?: SearchOrder;
  maxPerSession?: number;
}

export interface CandidateDiscovery {
  step: number;
  tool: "search" | "bash_ro" | "read_expansion";
  query?: string;
  retriever?: string;
  rank?: number;
  score?: number;
}

export interface MemoryCandidate {
  memoryId: string;
  scopeId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  timestamp?: string;
  preview: string;
  discoveries: CandidateDiscovery[];
  read: boolean;
  cited: boolean;
}

export interface Citation {
  memoryId: string;
  supports: string;
}

export interface EvidenceInventoryItem {
  item: string;
  memoryIds: string[];
}

export interface PiMemSelection {
  status: "sufficient" | "insufficient";
  citations: Citation[];
  evidenceSummary: string;
  count?: number;
  inventory?: EvidenceInventoryItem[];
}

export interface ToolTraceEntry {
  step: number;
  toolCallId: string;
  toolName: string;
  args: unknown;
  isError: boolean;
  content?: unknown;
  details?: unknown;
}

export type RetrievalProfile = "fts5" | "pimem-hybrid";

export interface RetrievalMetadata {
  retrievalProfile: RetrievalProfile;
  embeddingProfileId?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

export interface RetrievalMetricsSnapshot {
  embeddingCalls: number;
  embeddingLatencyMs: number;
  denseCandidateCount: number;
  rerankCandidateCount: number;
}

export interface ModelMetadata {
  providerId: string;
  modelId: string;
  thinkingLevel: string;
}

export interface SearchedMemory extends MemoryRecord {
  discoveries: CandidateDiscovery[];
  read: boolean;
  cited: boolean;
}

export interface PiMemResult {
  runId: string;
  scopeId: string;
  question: string;
  questionDate?: string;
  status: PiMemSelection["status"];
  citations: Citation[];
  evidenceSummary: string;
  count?: number;
  inventory?: EvidenceInventoryItem[];
  candidates: MemoryCandidate[];
  searchedMemories: SearchedMemory[];
  evidence: MemoryRecord[];
  trace: ToolTraceEntry[];
  metrics: {
    searchCalls: number;
    readCalls: number;
    bashCalls: number;
    candidateCount: number;
    evidenceCount: number;
    citedCount: number;
    retrievalProfile: RetrievalProfile;
    embeddingCalls: number;
    embeddingLatencyMs: number;
    denseCandidateCount: number;
    rerankCandidateCount: number;
    expiredNavigationResults: number;
  };
  retrieval: RetrievalMetadata;
  retrievalModel: ModelMetadata;
}

export interface BenchmarkQuery {
  scopeId: string;
  questionId: string;
  question: string;
  questionDate?: string;
}
