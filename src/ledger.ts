import type { StoreSearchHit } from "./store.js";
import type {
  Citation,
  MemoryCandidate,
  MemoryRecord,
  PiMemSelection,
} from "./types.js";
import { compactPreview } from "./util.js";

function cloneCandidate(candidate: MemoryCandidate): MemoryCandidate {
  return {
    ...candidate,
    discoveries: candidate.discoveries.map((discovery) => ({
      ...discovery,
    })),
  };
}

function cloneRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function cloneSelection(selection: PiMemSelection): PiMemSelection {
  return {
    ...selection,
    citations: selection.citations.map((citation) => ({ ...citation })),
    ...(selection.inventory === undefined
      ? {}
      : {
          inventory: selection.inventory.map((item) => ({
            item: item.item,
            memoryIds: [...item.memoryIds],
          })),
        }),
  };
}

/**
 * Per-question, in-memory provenance ledger.
 *
 * The only legal state transition is:
 *
 *   candidate -> read evidence -> cited evidence
 *
 * Raw records are never inferred from model output. Search and read tools add
 * them from structured store results, while finish may only select from records
 * that were successfully read during this run.
 */
export class MemoryLedger {
  readonly scopeId: string;

  private readonly candidatesById = new Map<string, MemoryCandidate>();
  private readonly evidenceById = new Map<string, MemoryRecord>();
  private readonly candidateRefById = new Map<string, number>();
  private readonly candidateIdByRef = new Map<number, string>();
  private readonly evidenceRefById = new Map<string, number>();
  private readonly evidenceIdByRef = new Map<number, string>();
  private acceptedSelection: PiMemSelection | undefined;
  private step = 0;

  constructor(scopeId: string) {
    const normalizedScopeId = scopeId.trim();
    if (!normalizedScopeId) {
      throw new Error("scopeId must not be empty");
    }
    this.scopeId = normalizedScopeId;
  }

  nextStep(): number {
    this.step += 1;
    return this.step;
  }

  get candidates(): MemoryCandidate[] {
    return [...this.candidatesById.values()].map(cloneCandidate);
  }

  get evidence(): MemoryRecord[] {
    return [...this.evidenceById.values()].map(cloneRecord);
  }

  get citations(): Citation[] {
    return (
      this.acceptedSelection?.citations.map((citation) => ({ ...citation })) ??
      []
    );
  }

  get selection(): PiMemSelection | undefined {
    return this.acceptedSelection
      ? cloneSelection(this.acceptedSelection)
      : undefined;
  }

  get readIds(): ReadonlySet<string> {
    return new Set(this.evidenceById.keys());
  }

  hasRead(memoryId: string): boolean {
    return this.evidenceById.has(memoryId);
  }

  candidateRef(memoryId: string): number | undefined {
    return this.candidateRefById.get(memoryId);
  }

  evidenceRef(memoryId: string): number | undefined {
    return this.evidenceRefById.get(memoryId);
  }

  resolveCandidateRefs(refs: readonly number[]): string[] {
    return [...new Set(refs)].map((ref) => {
      const memoryId = this.candidateIdByRef.get(ref);
      if (memoryId === undefined) {
        throw new Error(
          `Unknown candidate reference ${String(ref)}. Valid candidate range is ` +
            `${this.candidateIdByRef.size === 0 ? "empty" : `1-${String(this.candidateIdByRef.size)}`}.`,
        );
      }
      return memoryId;
    });
  }

  resolveEvidenceRef(ref: number): string {
    const memoryId = this.evidenceIdByRef.get(ref);
    if (memoryId === undefined) {
      throw new Error(
        `Unknown evidence reference ${String(ref)}. Valid evidence range is ` +
          `${this.evidenceIdByRef.size === 0 ? "empty" : `1-${String(this.evidenceIdByRef.size)}`}.`,
      );
    }
    return memoryId;
  }

  selectCandidates(memoryIds: readonly string[]): MemoryCandidate[] {
    const selected: MemoryCandidate[] = [];
    for (const memoryId of new Set(memoryIds)) {
      const candidate = this.candidatesById.get(memoryId);
      if (candidate) selected.push(cloneCandidate(candidate));
    }
    return selected;
  }

  recordSearchHits(
    hits: readonly StoreSearchHit[],
    step = this.nextStep(),
  ): MemoryCandidate[] {
    for (const hit of hits) {
      this.assertScope(hit.record);
      this.upsertCandidate(hit.record, hit.preview, {
        step,
        tool: "search",
        query: hit.query,
        retriever: hit.retriever,
        rank: hit.rank,
        score: hit.score,
      });
    }
    this.assertInvariants();
    return this.selectCandidates(hits.map((hit) => hit.record.memoryId));
  }

  /**
   * Records exact source material returned by read.
   *
   * Context neighbors (and direct IDs discovered through bash) may not have
   * appeared in search. They are first promoted to candidates with an explicit
   * read_expansion provenance entry, then marked as read evidence.
   */
  recordRead(
    records: readonly MemoryRecord[],
    step = this.nextStep(),
  ): MemoryRecord[] {
    for (const record of records) {
      this.assertScope(record);
      if (!this.candidatesById.has(record.memoryId)) {
        this.upsertCandidate(record, compactPreview(record.content), {
          step,
          tool: "read_expansion",
        });
      }

      const candidate = this.candidatesById.get(record.memoryId);
      if (!candidate) {
        throw new Error(`Internal ledger error: missing ${record.memoryId}`);
      }
      candidate.read = true;
      if (!this.evidenceById.has(record.memoryId)) {
        const evidenceRef = this.evidenceIdByRef.size + 1;
        this.evidenceRefById.set(record.memoryId, evidenceRef);
        this.evidenceIdByRef.set(evidenceRef, record.memoryId);
      }
      this.evidenceById.set(record.memoryId, cloneRecord(record));
    }
    this.assertInvariants();
    return records.map(cloneRecord);
  }

  recordBashDiscoveries(
    records: readonly MemoryRecord[],
    command: string,
    step = this.nextStep(),
  ): MemoryCandidate[] {
    for (const record of records) {
      this.assertScope(record);
      this.upsertCandidate(record, compactPreview(record.content), {
        step,
        tool: "bash_ro",
        query: command,
        retriever: "bash_ro",
      });
    }
    this.assertInvariants();
    return this.selectCandidates(records.map((record) => record.memoryId));
  }

  acceptSelection(input: PiMemSelection): PiMemSelection {
    const evidenceSummary = input.evidenceSummary.trim();
    if (input.status === "sufficient" && input.citations.length === 0) {
      throw new Error("A sufficient selection must cite at least one memory");
    }
    if (!evidenceSummary) {
      throw new Error("evidenceSummary must not be empty");
    }

    const citations = input.citations.map((citation) => {
      const memoryId = citation.memoryId.trim();
      const supports = citation.supports.trim();
      if (!memoryId) {
        throw new Error("Citation memoryId must not be empty");
      }
      if (!supports) {
        throw new Error(`Citation supports must not be empty: ${memoryId}`);
      }
      const evidence = this.evidenceById.get(memoryId);
      if (!evidence) {
        throw new Error(
          `Finish rejected: citation must reference memory read in this run: ` +
            `${memoryId}. Do not repeat this call; call read for that memory ` +
            `before citing it, or remove the citation.`,
        );
      }
      if (!evidence.content.trim()) {
        throw new Error(`Cited memory has empty raw content: ${memoryId}`);
      }
      return { memoryId, supports };
    });

    const citedMemoryIds = new Set(
      citations.map((citation) => citation.memoryId),
    );
    const inventory = input.inventory?.map((entry) => {
      const item = entry.item.trim();
      const memoryIds = [
        ...new Set(entry.memoryIds.map((memoryId) => memoryId.trim())),
      ].filter(Boolean);
      if (!item) throw new Error("Inventory item must not be empty");
      if (memoryIds.length === 0) {
        throw new Error(`Inventory item must cite read memory: ${item}`);
      }
      for (const memoryId of memoryIds) {
        if (!this.evidenceById.has(memoryId)) {
          throw new Error(
            `Inventory item must reference memory read in this run: ${memoryId}`,
          );
        }
        if (!citedMemoryIds.has(memoryId)) {
          throw new Error(
            `Inventory item must reference a cited memory: ${memoryId}`,
          );
        }
      }
      return { item, memoryIds };
    });
    if (
      input.count !== undefined &&
      (!Number.isSafeInteger(input.count) || input.count < 0)
    ) {
      throw new Error("Evidence count must be a non-negative integer");
    }

    const selection: PiMemSelection = {
      status: input.status,
      citations,
      evidenceSummary,
      ...(input.count === undefined ? {} : { count: input.count }),
      ...(inventory === undefined ? {} : { inventory }),
    };
    if (this.acceptedSelection) {
      if (JSON.stringify(this.acceptedSelection) === JSON.stringify(selection)) {
        return cloneSelection(this.acceptedSelection);
      }
      throw new Error("A different evidence selection has already been accepted for this run");
    }

    for (const citation of citations) {
      const candidate = this.candidatesById.get(citation.memoryId);
      if (!candidate) {
        throw new Error(
          `Internal ledger error: cited evidence is not a candidate: ${citation.memoryId}`,
        );
      }
      candidate.cited = true;
    }

    this.acceptedSelection = selection;
    this.assertInvariants();
    return cloneSelection(selection);
  }

  assertInvariants(): void {
    for (const [memoryId] of this.evidenceById) {
      const candidate = this.candidatesById.get(memoryId);
      if (!candidate || !candidate.read) {
        throw new Error(
          `Ledger invariant violated: evidence is not a read candidate: ${memoryId}`,
        );
      }
    }

    for (const citation of this.acceptedSelection?.citations ?? []) {
      const candidate = this.candidatesById.get(citation.memoryId);
      if (!this.evidenceById.has(citation.memoryId)) {
        throw new Error(
          `Ledger invariant violated: citation is not evidence: ${citation.memoryId}`,
        );
      }
      if (!candidate?.cited) {
        throw new Error(
          `Ledger invariant violated: citation is not marked cited: ${citation.memoryId}`,
        );
      }
    }
  }

  private assertScope(record: MemoryRecord): void {
    if (record.scopeId !== this.scopeId) {
      throw new Error(
        `Memory belongs to scope ${record.scopeId}, expected ${this.scopeId}: ${record.memoryId}`,
      );
    }
  }

  private upsertCandidate(
    record: MemoryRecord,
    preview: string,
    discovery: MemoryCandidate["discoveries"][number],
  ): void {
    const existing = this.candidatesById.get(record.memoryId);
    if (existing) {
      const discoveryKey = JSON.stringify(discovery);
      const alreadyRecorded = existing.discoveries.some(
        (item) => JSON.stringify(item) === discoveryKey,
      );
      if (!alreadyRecorded) existing.discoveries.push({ ...discovery });
      return;
    }

    const candidate: MemoryCandidate = {
      memoryId: record.memoryId,
      scopeId: record.scopeId,
      sessionId: record.sessionId,
      turnIndex: record.turnIndex,
      role: record.role,
      preview,
      discoveries: [{ ...discovery }],
      read: false,
      cited: false,
    };
    if (record.timestamp !== undefined) {
      candidate.timestamp = record.timestamp;
    }
    this.candidatesById.set(record.memoryId, candidate);
    const candidateRef = this.candidateIdByRef.size + 1;
    this.candidateRefById.set(record.memoryId, candidateRef);
    this.candidateIdByRef.set(candidateRef, record.memoryId);
  }
}
