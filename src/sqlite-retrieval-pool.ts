import { Worker } from "node:worker_threads";
import type {
  EmbeddingIndexStatus,
  EmbeddingProfile,
  StoreSearchHit,
  VectorIndexGenerationStatus,
} from "./store.js";
import type {
  SqliteRetrievalOperation,
  SqliteRetrievalResult,
  SqliteWorkerResponse,
} from "./sqlite-retrieval-protocol.js";
import type {
  EvidenceOperatorSearchContext,
  MemoryRecord,
  SearchRequest,
} from "./types.js";

export interface SqliteRetrievalPoolOptions {
  databasePath: string;
  size: number;
}

interface PendingTask {
  id: number;
  operation: SqliteRetrievalOperation;
  resolve: (value: SqliteRetrievalResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  settled: boolean;
}

interface WorkerSlot {
  worker: Worker;
  task: PendingTask | undefined;
  retired: boolean;
}

function abortedError(): Error {
  return new Error("SQLite retrieval request aborted");
}

export class SqliteRetrievalWorkerPool {
  private readonly databasePath: string;
  private readonly size: number;
  private readonly slots: WorkerSlot[] = [];
  private readonly allWorkers = new Set<Worker>();
  private readonly queue: PendingTask[] = [];
  private nextTaskId = 1;
  private closing = false;

  private constructor(options: SqliteRetrievalPoolOptions) {
    if (!options.databasePath) {
      throw new Error("SQLite retrieval pool requires a database path");
    }
    if (!Number.isSafeInteger(options.size) || options.size < 1 || options.size > 128) {
      throw new Error("SQLite retrieval pool size must be between 1 and 128");
    }
    this.databasePath = options.databasePath;
    this.size = options.size;
  }

  static async create(
    options: SqliteRetrievalPoolOptions,
  ): Promise<SqliteRetrievalWorkerPool> {
    const pool = new SqliteRetrievalWorkerPool(options);
    try {
      const startupBatchSize = Math.min(16, options.size);
      for (let offset = 0; offset < options.size; offset += startupBatchSize) {
        const count = Math.min(startupBatchSize, options.size - offset);
        await Promise.all(
          Array.from({ length: count }, () => pool.spawnWorker()),
        );
      }
      return pool;
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  get activeCount(): number {
    return this.slots.filter((slot) => slot.task !== undefined).length;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  private spawnWorker(): Promise<void> {
    if (this.closing) return Promise.resolve();
    const worker = new Worker(
      new URL("./sqlite-retrieval-worker.js", import.meta.url),
      { workerData: { databasePath: this.databasePath } },
    );
    const slot: WorkerSlot = { worker, task: undefined, retired: false };
    this.allWorkers.add(worker);
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      const failBeforeReady = (error: Error): void => {
        if (ready) return;
        ready = true;
        reject(error);
      };
      worker.on("message", (message: SqliteWorkerResponse) => {
        if (message.type === "ready") {
          if (ready) return;
          ready = true;
          if (this.closing) {
            slot.retired = true;
            void worker.terminate();
            resolve();
            return;
          }
          this.slots.push(slot);
          resolve();
          this.dispatch();
          return;
        }
        this.handleResponse(slot, message);
      });
      worker.on("error", (error) => {
        failBeforeReady(error);
        this.retire(slot, error);
      });
      worker.on("exit", (code) => {
        this.allWorkers.delete(worker);
        const error = new Error(`SQLite retrieval worker exited with code ${code}`);
        failBeforeReady(error);
        this.retire(slot, error);
      });
    });
  }

  private handleResponse(
    slot: WorkerSlot,
    message: Exclude<SqliteWorkerResponse, { type: "ready" }>,
  ): void {
    if (slot.retired) return;
    const task = slot.task;
    if (!task || task.id !== message.id) {
      this.retire(slot, new Error("SQLite retrieval worker protocol mismatch"));
      return;
    }
    slot.task = undefined;
    task.signal?.removeEventListener("abort", task.abort!);
    if (!task.settled) {
      task.settled = true;
      if (message.type === "error") task.reject(new Error(message.message));
      else task.resolve(message.result);
    }
    this.dispatch();
  }

  private retire(slot: WorkerSlot, error: Error): void {
    if (slot.retired) return;
    slot.retired = true;
    const index = this.slots.indexOf(slot);
    const wasRegistered = index >= 0;
    if (wasRegistered) this.slots.splice(index, 1);
    const task = slot.task;
    slot.task = undefined;
    if (task) {
      task.signal?.removeEventListener("abort", task.abort!);
      if (!task.settled) {
        task.settled = true;
        task.reject(error);
      }
    }
    void slot.worker.terminate().catch(() => undefined);
    if (!this.closing && wasRegistered) {
      void this.spawnWorker().catch((spawnError: unknown) => {
        const reason = spawnError instanceof Error
          ? spawnError
          : new Error(String(spawnError));
        while (this.queue.length > 0) {
          const queued = this.queue.shift()!;
          if (!queued.settled) {
            queued.settled = true;
            queued.reject(reason);
          }
        }
      });
    }
  }

  private dispatch(): void {
    if (this.closing) return;
    for (const slot of this.slots) {
      if (slot.retired || slot.task !== undefined) continue;
      let task = this.queue.shift();
      while (task?.signal?.aborted) {
        if (!task.settled) {
          task.settled = true;
          task.reject(abortedError());
        }
        task = this.queue.shift();
      }
      if (!task) return;
      slot.task = task;
      slot.worker.postMessage({ id: task.id, operation: task.operation });
    }
  }

  private abortTask(task: PendingTask): void {
    if (task.settled) return;
    task.settled = true;
    const queuedIndex = this.queue.indexOf(task);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      task.reject(abortedError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.task === task);
    task.reject(abortedError());
    if (slot) this.retire(slot, abortedError());
  }

  private call<T extends SqliteRetrievalResult>(
    operation: SqliteRetrievalOperation,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closing) {
      return Promise.reject(new Error("SQLite retrieval pool is closed"));
    }
    if (signal?.aborted) return Promise.reject(abortedError());
    return new Promise<T>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextTaskId,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
        ...(signal === undefined ? {} : { signal }),
        settled: false,
      };
      this.nextTaskId += 1;
      if (signal) {
        task.abort = () => this.abortTask(task);
        signal.addEventListener("abort", task.abort, { once: true });
      }
      this.queue.push(task);
      this.dispatch();
    });
  }

  getEmbeddingIndexStatus(
    scopeId: string,
    profile: EmbeddingProfile,
    signal?: AbortSignal,
  ): Promise<EmbeddingIndexStatus> {
    return this.call({ kind: "embedding-status", scopeId, profile }, signal);
  }

  search(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<StoreSearchHit[]> {
    return this.searchLexical(scopeId, request, signal);
  }

  searchLexical(
    scopeId: string,
    request: SearchRequest,
    signal?: AbortSignal,
  ): Promise<StoreSearchHit[]> {
    return this.call({ kind: "lexical-search", scopeId, request }, signal);
  }

  expandEvidenceOperator(
    scopeId: string,
    request: SearchRequest,
    context: EvidenceOperatorSearchContext,
    seedHits: readonly StoreSearchHit[],
    signal?: AbortSignal,
  ): Promise<StoreSearchHit[]> {
    return this.call({
      kind: "evidence-expand",
      scopeId,
      request,
      context,
      seedHits: [...seedHits],
    }, signal);
  }

  read(
    scopeId: string,
    memoryIds: string[],
    contextBefore = 0,
    contextAfter = 0,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    return this.call({
      kind: "read",
      scopeId,
      memoryIds,
      contextBefore,
      contextAfter,
    }, signal);
  }

  getRecords(
    scopeId: string,
    memoryIds: string[],
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    return this.call({ kind: "get-records", scopeId, memoryIds }, signal);
  }

  assertVectorIndexGenerationReady(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<VectorIndexGenerationStatus> {
    return this.call({ kind: "generation-ready", generationId }, signal);
  }

  hasScopeRecords(scopeId: string, signal?: AbortSignal): Promise<boolean> {
    return this.call({ kind: "scope-exists", scopeId }, signal);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      task.signal?.removeEventListener("abort", task.abort!);
      if (!task.settled) {
        task.settled = true;
        task.reject(new Error("SQLite retrieval pool closed"));
      }
    }
    const slots = this.slots.splice(0);
    for (const slot of slots) {
      slot.retired = true;
      if (slot.task) {
        slot.task.signal?.removeEventListener("abort", slot.task.abort!);
        if (!slot.task.settled) {
          slot.task.settled = true;
          slot.task.reject(new Error("SQLite retrieval pool closed"));
        }
      }
    }
    const workers = [...this.allWorkers];
    await Promise.all(workers.map((worker) => worker.terminate()));
    this.allWorkers.clear();
  }
}
