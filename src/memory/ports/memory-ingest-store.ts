import type { MemoryRecord, ScopeIngestStatus } from "../model/memory.js";

export interface ScopeExport {
  scopeId: string;
  path: string;
  memoryCount: number;
}

export interface MemoryIngestStore {
  ingestScope(
    scopeId: string,
    records: MemoryRecord[],
  ): ScopeIngestStatus;
  exportScope(scopeId: string, exportRoot: string): Promise<ScopeExport>;
}
