import { parentPort, workerData } from "node:worker_threads";
import { MemoryStore } from "./store.js";
import type {
  SqliteRetrievalOperation,
  SqliteRetrievalResult,
  SqliteWorkerRequest,
  SqliteWorkerResponse,
} from "./sqlite-retrieval-protocol.js";

if (!parentPort) throw new Error("SQLite retrieval worker requires a parent port");
const port = parentPort;
const data = workerData as { databasePath?: unknown };
if (typeof data.databasePath !== "string" || !data.databasePath) {
  throw new Error("SQLite retrieval worker requires a database path");
}

const store = await MemoryStore.create(data.databasePath, { readOnly: true });

function execute(operation: SqliteRetrievalOperation): SqliteRetrievalResult {
  switch (operation.kind) {
    case "embedding-status":
      return store.getEmbeddingIndexStatus(operation.scopeId, operation.profile);
    case "lexical-search":
      return store.search(operation.scopeId, operation.request);
    case "evidence-expand":
      return store.expandEvidenceOperator(
        operation.scopeId,
        operation.request,
        operation.context,
        operation.seedHits,
      );
    case "read":
      return store.read(
        operation.scopeId,
        operation.memoryIds,
        operation.contextBefore,
        operation.contextAfter,
      );
    case "get-records":
      return store.getRecords(operation.scopeId, operation.memoryIds);
    case "generation-ready":
      return store.assertVectorIndexGenerationReady(operation.generationId);
    case "scope-exists":
      return store.hasScopeRecords(operation.scopeId);
  }
}

port.on("message", (request: SqliteWorkerRequest) => {
  try {
    const response: SqliteWorkerResponse = {
      type: "result",
      id: request.id,
      result: execute(request.operation),
    };
    port.postMessage(response);
  } catch (error) {
    const response: SqliteWorkerResponse = {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(response);
  }
});

port.postMessage({ type: "ready" } satisfies SqliteWorkerResponse);
port.once("close", () => store.close());
