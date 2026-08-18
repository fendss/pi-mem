import type { MemoryRecord, MemoryRole } from "../../memory/index.js";
import type {
  RetrievalMetadata,
  RetrievalProfile,
} from "../../retrieval/index.js";

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

export interface ModelMetadata {
  providerId: string;
  modelId: string;
  responseModels: string[];
  thinkingLevel: string;
  transport: "sse" | "non-stream";
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
