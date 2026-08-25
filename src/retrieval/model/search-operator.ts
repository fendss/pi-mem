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
  composition?: SearchOperatorCompositionTrace;
}

/** Internal immutable-history search value. It is not Evidence. */
export interface CandidateSet {
  readonly hits: readonly RetrievalHit[];
}

export type SearchOperatorCombineMethod = "union" | "rrf";

export interface SearchOperatorDefinitionSearchStep {
  id: string;
  kind: "search";
  operator: string;
  limit?: number;
}

export interface SearchOperatorDefinitionCombineStep {
  id: string;
  kind: "combine";
  inputs: string[];
  method: SearchOperatorCombineMethod;
  limit?: number;
}

/**
 * A deliberately small, declarative operator definition.
 *
 * Search steps call already trusted operators. Combine steps transform only
 * CandidateSets, so runtime-created operators can never read source text or
 * promote evidence by themselves.
 */
export interface SearchOperatorDefinition {
  id: string;
  version: string;
  guide: SearchOperatorGuide;
  steps: Array<
    SearchOperatorDefinitionSearchStep | SearchOperatorDefinitionCombineStep
  >;
  output: string;
}

export interface SearchOperatorCompositionStepTrace {
  id: string;
  kind: "search" | "combine";
  operator?: string;
  operatorVersion?: string;
  inputs?: string[];
  method?: SearchOperatorCombineMethod;
  candidateCount: number;
}

export interface SearchOperatorCompositionTrace {
  definitionHash: string;
  definitionRevision: number;
  steps: SearchOperatorCompositionStepTrace[];
}

export interface SearchOperatorCatalogIdentity {
  revision: number;
  hash: string;
}

export interface DefinedSearchOperator {
  id: string;
  version: string;
  definitionHash: string;
  catalog: SearchOperatorCatalogIdentity;
}

export interface SearchOperatorDefinitionSnapshot {
  revision: number;
  definitionHash: string;
  definition: SearchOperatorDefinition;
}
