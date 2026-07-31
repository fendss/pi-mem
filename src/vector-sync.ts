import { createHash } from "node:crypto";
import {
  QdrantHttpError,
  type QdrantCollectionInfo,
  type QdrantCollectionSpec,
  type QdrantCountRequest,
  type QdrantVectorPoint,
} from "./qdrant.js";
import {
  type MemoryStore,
  type VectorIndexGenerationStatus,
  type VectorSyncClaim,
} from "./store.js";

export interface QdrantVectorIndexClient {
  ensureCollection(
    spec: QdrantCollectionSpec,
    signal?: AbortSignal,
  ): Promise<void>;
  getCollection(
    name: string,
    signal?: AbortSignal,
  ): Promise<QdrantCollectionInfo | undefined>;
  upsert(
    collection: string,
    dimensions: number,
    points: readonly QdrantVectorPoint[],
    signal?: AbortSignal,
  ): Promise<void>;
  count(request: QdrantCountRequest): Promise<number>;
}

export interface QdrantVectorSynchronizerOptions {
  store: MemoryStore;
  client: QdrantVectorIndexClient;
  generationId: string;
  collection: QdrantCollectionSpec;
  batchSize?: number;
  concurrentBatches?: number;
  leaseMs?: number;
  verificationPollMs?: number;
  verificationTimeoutMs?: number;
}

export interface VectorSyncProgress {
  synchronizedNow: number;
  status: VectorIndexGenerationStatus;
}

function boundedPositiveInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function deterministicQdrantPointId(
  scopeId: string,
  memoryId: string,
  profileId: string,
): string {
  if (!scopeId || !memoryId || !profileId) {
    throw new Error("Qdrant point identity fields must not be empty");
  }
  const bytes = Buffer.from(
    createHash("sha256")
      .update("pimem-qdrant-point-v1\0")
      .update(scopeId)
      .update("\0")
      .update(memoryId)
      .update("\0")
      .update(profileId)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function pointFromClaim(claim: VectorSyncClaim): QdrantVectorPoint {
  return {
    pointId: deterministicQdrantPointId(
      claim.scopeId,
      claim.memoryId,
      claim.profileId,
    ),
    vector: [...claim.vector],
    generationId: claim.generationId,
    scopeId: claim.scopeId,
    profileId: claim.profileId,
    contentHash: claim.contentHash,
  };
}

function permanentQdrantFailure(error: unknown): boolean {
  return error instanceof QdrantHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    !new Set([408, 429]).has(error.status);
}

function terminalVerificationFailure(error: unknown): boolean {
  return permanentQdrantFailure(error) ||
    (error instanceof Error && /count mismatch/u.test(error.message));
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Vector synchronization aborted");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Vector synchronization aborted"));
    };
    function finish(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class QdrantVectorSynchronizer {
  private readonly store: MemoryStore;
  private readonly client: QdrantVectorIndexClient;
  private readonly generationId: string;
  private readonly collection: QdrantCollectionSpec;
  private readonly batchSize: number;
  private readonly concurrentBatches: number;
  private readonly leaseMs: number;
  private readonly verificationPollMs: number;
  private readonly verificationTimeoutMs: number;

  constructor(options: QdrantVectorSynchronizerOptions) {
    this.store = options.store;
    this.client = options.client;
    this.generationId = options.generationId;
    this.collection = options.collection;
    this.batchSize = boundedPositiveInteger(
      options.batchSize ?? 512,
      "Vector sync batch size",
      10_000,
    );
    this.concurrentBatches = boundedPositiveInteger(
      options.concurrentBatches ?? 4,
      "Vector sync concurrency",
      64,
    );
    this.leaseMs = boundedPositiveInteger(
      options.leaseMs ?? 120_000,
      "Vector sync lease",
      86_400_000,
    );
    this.verificationPollMs = boundedPositiveInteger(
      options.verificationPollMs ?? 1_000,
      "Vector verification poll interval",
      60_000,
    );
    this.verificationTimeoutMs = boundedPositiveInteger(
      options.verificationTimeoutMs ?? 3_600_000,
      "Vector verification timeout",
      86_400_000,
    );
  }

  private assertConfiguration(status: VectorIndexGenerationStatus): void {
    if (
      status.generationId !== this.generationId ||
      status.collectionName !== this.collection.name ||
      status.profile.dimensions !== this.collection.dimensions
    ) {
      throw new Error(`Vector synchronizer configuration mismatch: ${this.generationId}`);
    }
  }

  async initialize(signal?: AbortSignal): Promise<VectorIndexGenerationStatus> {
    const status = this.store.getVectorIndexGeneration(this.generationId);
    this.assertConfiguration(status);
    try {
      await this.client.ensureCollection(this.collection, signal);
    } catch (error) {
      if (permanentQdrantFailure(error)) {
        this.store.failVectorIndexGeneration(this.generationId, error);
      }
      throw error;
    }
    return status;
  }

  private async synchronizeWorker(signal?: AbortSignal): Promise<number> {
    let synchronized = 0;
    while (true) {
      if (signal?.aborted) throw new Error("Vector synchronization aborted");
      const claims = this.store.claimVectorSyncBatch(
        this.generationId,
        this.batchSize,
        this.leaseMs,
      );
      if (claims.length === 0) return synchronized;
      const sequenceIds = claims.map((claim) => claim.sequenceId);
      try {
        await this.client.upsert(
          this.collection.name,
          this.collection.dimensions,
          claims.map(pointFromClaim),
          signal,
        );
        this.store.completeVectorSyncBatch(this.generationId, sequenceIds);
        synchronized += claims.length;
      } catch (error) {
        this.store.releaseVectorSyncBatch(this.generationId, sequenceIds, error);
        if (permanentQdrantFailure(error)) {
          this.store.failVectorIndexGeneration(this.generationId, error);
        }
        throw error;
      }
    }
  }

  async synchronizeAvailable(signal?: AbortSignal): Promise<VectorSyncProgress> {
    const initialized = await this.initialize(signal);
    if (!new Set(["ingesting", "draining"]).has(initialized.state)) {
      return { synchronizedNow: 0, status: initialized };
    }
    const counts = await Promise.all(
      Array.from({ length: this.concurrentBatches }, () =>
        this.synchronizeWorker(signal)
      ),
    );
    return {
      synchronizedNow: counts.reduce((sum, value) => sum + value, 0),
      status: this.store.getVectorIndexGeneration(this.generationId),
    };
  }

  private async waitForCollectionIndex(
    expectedVectorCount: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + this.verificationTimeoutMs;
    while (true) {
      const info = await this.client.getCollection(this.collection.name, signal);
      if (!info) {
        throw new Error(`Qdrant collection disappeared: ${this.collection.name}`);
      }
      const indexingRequired =
        expectedVectorCount >= this.collection.hnsw.fullScanThreshold;
      if (
        info.status.toLowerCase() === "green" &&
        info.optimizerStatus.toLowerCase() === "ok" &&
        (!indexingRequired || info.indexedVectorsCount >= expectedVectorCount)
      ) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Qdrant collection indexing did not finish: ${this.collection.name}`);
      }
      await wait(this.verificationPollMs, signal);
    }
  }

  private async verifyCounts(
    status: VectorIndexGenerationStatus,
    signal?: AbortSignal,
  ): Promise<number> {
    const observed = await this.client.count({
      collection: status.collectionName,
      generationId: status.generationId,
      profileId: status.profile.profileId,
      ...(signal === undefined ? {} : { signal }),
    });
    if (observed !== status.expectedVectorCount) {
      throw new Error(
        `Qdrant generation count mismatch: ${observed}/${status.expectedVectorCount}`,
      );
    }
    const scopes = this.store.listVectorGenerationScopeCounts(status.generationId);
    for (const scope of scopes) {
      const scopeCount = await this.client.count({
        collection: status.collectionName,
        generationId: status.generationId,
        profileId: status.profile.profileId,
        scopeId: scope.scopeId,
        ...(signal === undefined ? {} : { signal }),
      });
      if (scopeCount !== scope.count) {
        throw new Error(
          `Qdrant scope count mismatch for ${scope.scopeId}: ${scopeCount}/${scope.count}`,
        );
      }
    }
    return observed;
  }

  async finalize(signal?: AbortSignal): Promise<VectorIndexGenerationStatus> {
    let status = this.store.getVectorIndexGeneration(this.generationId);
    this.assertConfiguration(status);
    if (status.state === "ready") return status;
    if (status.state === "failed") {
      throw new Error(`Cannot finalize failed vector generation: ${this.generationId}`);
    }
    if (status.state === "ingesting" || status.state === "draining") {
      status = this.store.sealVectorIndexGeneration(this.generationId);
    }
    if (status.state === "draining") {
      await this.synchronizeAvailable(signal);
      status = this.store.beginVectorIndexVerification(this.generationId);
    }
    if (status.state !== "verifying") {
      throw new Error(`Vector generation cannot be verified: ${this.generationId}`);
    }
    await this.waitForCollectionIndex(status.expectedVectorCount, signal);
    try {
      const observed = await this.verifyCounts(status, signal);
      return this.store.markVectorIndexGenerationReady(
        this.generationId,
        observed,
      );
    } catch (error) {
      if (terminalVerificationFailure(error)) {
        this.store.failVectorIndexGeneration(this.generationId, error);
      }
      throw error;
    }
  }
}
