import type {
  EmbeddingIndexStatus,
  EmbeddingProfile,
  StoreSearchHit,
  VectorIndexGenerationStatus,
} from "./store.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  SearchRequest,
} from "./types.js";

export type SqliteRetrievalOperation =
  | {
      kind: "embedding-status";
      scopeId: string;
      profile: EmbeddingProfile;
    }
  | {
      kind: "lexical-search";
      scopeId: string;
      request: SearchRequest;
    }
  | {
      kind: "evidence-expand";
      scopeId: string;
      request: SearchRequest;
      context: EvidenceOperatorSearchContext;
      seedHits: StoreSearchHit[];
    }
  | {
      kind: "read";
      scopeId: string;
      memoryIds: string[];
      contextBefore: number;
      contextAfter: number;
    }
  | {
      kind: "get-records";
      scopeId: string;
      memoryIds: string[];
    }
  | {
      kind: "generation-ready";
      generationId: string;
    }
  | {
      kind: "scope-exists";
      scopeId: string;
    };

export type SqliteRetrievalResult =
  | EmbeddingIndexStatus
  | StoreSearchHit[]
  | MemoryRecord[]
  | VectorIndexGenerationStatus
  | boolean;

export interface SqliteWorkerRequest {
  id: number;
  operation: SqliteRetrievalOperation;
}

export type SqliteWorkerResponse =
  | { type: "ready" }
  | { type: "result"; id: number; result: SqliteRetrievalResult }
  | { type: "error"; id: number; message: string };
