import type { MemoryRole } from "../../memory/index.js";
import type { MemoryEvidence } from "./memory-evidence.js";
import type { MemoryPassage } from "../../retrieval/index.js";
import type {
  RetrievalMetadata,
  RetrievalMetadataFilter,
  RetrievalProfile,
  SearchOperatorCatalogIdentity,
  SearchOperatorDefinitionSnapshot,
} from "../../retrieval/index.js";

export interface CandidateDiscovery {
  step: number;
  tool: "search" | "bash_ro" | "read_expansion";
  query?: string;
  retriever?: string;
  rank?: number;
  score?: number;
  /** Query-authored metadata filters used by the physical retrieval route. */
  metadataFilters?: RetrievalMetadataFilter[];
}

export interface MemoryCandidate {
  /** Passage identity used by the opaque C reference. */
  candidateId: string;
  /** Immutable parent memory identity used for citation and provenance. */
  memoryId: string;
  scopeId: string;
  sessionId: string;
  turnIndex: number;
  role: MemoryRole;
  timestamp?: string;
  preview: string;
  passage?: MemoryPassage;
  discoveries: CandidateDiscovery[];
  inspected: boolean;
  committed: boolean;
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

export interface ModelMetadata {
  providerId: string;
  modelId: string;
  responseModels: string[];
  thinkingLevel: string;
  transport: "sse" | "non-stream";
}

/** Provider-reported usage summed across every retrieval-Agent turn. */
export interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
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
  evidence: MemoryEvidence[];
  trace: ToolTraceEntry[];
  operatorCatalog: SearchOperatorCatalogIdentity;
  operatorDefinitions: SearchOperatorDefinitionSnapshot[];
  metrics: {
    searchCalls: number;
    readCalls: number;
    bashCalls: number;
    operatorDefinitionCalls: number;
    candidateCount: number;
    inspectedEvidenceCount: number;
    evidenceCount: number;
    citedCount: number;
    retrievalProfile: RetrievalProfile;
    embeddingCalls: number;
    embeddingLatencyMs: number;
    denseCandidateCount: number;
    rerankCandidateCount: number;
    expiredNavigationResults: number;
    compactedReadResults: number;
  };
  retrieval: RetrievalMetadata;
  retrievalModel: ModelMetadata;
  usage: ModelUsage;
}
