import type {
  EvidenceOperatorResult,
  RetrievalHit,
  SearchRequest,
} from "./retrieval.js";

export type SearchOperatorCost = "low" | "medium" | "high";

export interface SearchOperatorGuide {
  summary: string;
  useWhen: readonly string[];
  avoidWhen?: readonly string[];
  cost: SearchOperatorCost;
}

export interface SearchOperatorCatalogEntry {
  id: string;
  version: string;
  guide: SearchOperatorGuide;
}

export interface SearchOperatorInput {
  queries: string[];
  limit: number;
  maxPerSession?: number;
}

export interface SearchOperatorExecutionContext {
  scopeId: string;
  questionDate?: string;
  signal?: AbortSignal;
}

export interface SearchOperatorOutput {
  request: SearchRequest;
  hits: RetrievalHit[];
  operatorResult?: EvidenceOperatorResult;
}
