import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ReadOnlyNavigation } from "../../../ports/read-only-navigation.js";
import type { MemoryRecord } from "../../../../memory/index.js";
import type {
  DefinedSearchOperator,
  EvidenceOperatorResult,
  MemoryToolStore,
  RuntimeSearchOperatorCatalog,
  SearchOperatorCatalog,
  SearchOperatorCompositionTrace,
  SearchOperatorDefinitionSnapshot,
  SearchRequest,
} from "../../../../retrieval/index.js";
import type {
  MemoryCandidate,
  MemoryEvidence,
  PiMemSelection,
} from "../../../index.js";
import type { MemoryLedger } from "../../../model/memory-ledger.js";
import {
  BashRoParameters,
  DefineOperatorParameters,
  FinishParameters,
  ReadParameters,
  type SearchParametersSchema,
} from "./schemas.js";

export interface SearchToolDetails {
  kind: "search";
  request: SearchRequest;
  operator: string;
  operatorVersion: string;
  operatorResult?: EvidenceOperatorResult;
  composition?: SearchOperatorCompositionTrace;
  candidateReferences: Array<{ candidateRef: number; memoryId: string }>;
  candidates: MemoryCandidate[];
  repeatedQueries?: string[];
}

export interface DefineOperatorToolDetails {
  kind: "define_operator";
  definition: DefinedSearchOperator;
  snapshot: SearchOperatorDefinitionSnapshot;
}

export interface ReadToolDetails {
  kind: "read";
  requestedCandidateRefs: number[];
  requestedMemoryIds: string[];
  contextBefore: number;
  contextAfter: number;
  evidence: Array<Pick<
    MemoryEvidence,
    | "memoryId"
    | "scopeId"
    | "sessionId"
    | "turnIndex"
    | "contentHash"
    | "sourceContentHash"
    | "sourceContentLength"
    | "truncated"
  > & { excerpts: Array<{ start: number; end: number }> }>;
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

export interface MemoryLookup {
  findMentionedMemoryIds(scopeId: string, text: string): string[];
  getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[];
}

export interface CreatePiMemToolsOptions {
  store: MemoryToolStore;
  operatorRegistry: SearchOperatorCatalog;
  operatorDefinitions?: RuntimeSearchOperatorCatalog;
  scopeId: string;
  ledger: MemoryLedger;
  bashRo?: {
    runner: ReadOnlyNavigation;
    scopePath: string;
    store: MemoryLookup;
  };
  beforeFinish?: (selection: PiMemSelection) => Promise<void> | void;
  question?: string;
  /** Current runtime inputs used only to focus bounded exact evidence excerpts. */
  evidenceFocus?: () => readonly string[];
  questionDate?: string;
  searchDefaults?: Pick<SearchRequest, "limit" | "order" | "maxPerSession">;
  searchGuidance?: string;
}

export interface PiMemTools {
  search: AgentTool<SearchParametersSchema, SearchToolDetails>;
  defineOperator?: AgentTool<
    typeof DefineOperatorParameters,
    DefineOperatorToolDetails
  >;
  read: AgentTool<typeof ReadParameters, ReadToolDetails>;
  bashRo?: AgentTool<typeof BashRoParameters, BashRoToolDetails>;
  finish: AgentTool<typeof FinishParameters, FinishToolDetails>;
  all: AgentTool[];
}
