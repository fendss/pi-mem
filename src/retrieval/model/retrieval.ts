import type { MemoryRecord, MemoryRole } from "../../memory/index.js";

export type SearchOrder =
  | "relevance"
  | "chronological"
  | "reverse-chronological";

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

export interface RetrievalHit {
  record: MemoryRecord;
  query: string;
  retriever:
    | "fts5"
    | "pimem-hybrid"
    | "pimem-timeline-db"
    | "pimem-aggregate-db";
  rank: number;
  score: number;
  preview: string;
  operatorNumericFactIndexes?: number[];
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
