import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ReadOnlyBash } from "../../docker/read-only-shell.js";
import type { MemoryRecord } from "../../../../memory/index.js";
import type {
  EvidenceOperatorResult,
  MemoryToolStore,
  SearchOperatorRegistry,
  SearchRequest,
} from "../../../../retrieval/index.js";
import type {
  MemoryCandidate,
  PiMemSelection,
} from "../../../index.js";
import type { MemoryLedger } from "../../../model/memory-ledger.js";
import {
  BashRoParameters,
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
  operatorRegistry: SearchOperatorRegistry;
  scopeId: string;
  ledger: MemoryLedger;
  bashRo?: {
    runner: ReadOnlyBash;
    scopePath: string;
    store: MemoryLookup;
  };
  beforeFinish?: (selection: PiMemSelection) => Promise<void> | void;
  question?: string;
  questionDate?: string;
  searchDefaults?: Pick<SearchRequest, "limit" | "order" | "maxPerSession">;
  searchGuidance?: string;
}

export interface PiMemTools {
  search: AgentTool<SearchParametersSchema, SearchToolDetails>;
  read: AgentTool<typeof ReadParameters, ReadToolDetails>;
  bashRo?: AgentTool<typeof BashRoParameters, BashRoToolDetails>;
  finish: AgentTool<typeof FinishParameters, FinishToolDetails>;
  all: AgentTool[];
}
