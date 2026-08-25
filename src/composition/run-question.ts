import {
  runPiMem,
  type PiMemResult,
  type PiMemSkill,
} from "../evidence-agent/index.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
} from "../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../platform/sqlite/pimem-store.js";
import type { RetrievalProfile } from "../retrieval/index.js";
import { createReadOnlyScopeNavigation } from "./create-read-only-navigation.js";
import { createRetrievalContext } from "./create-retrieval-context.js";

export interface PiMemWorkspacePaths {
  database: string;
  sanitized: string;
}

export async function runQuestion(
  paths: PiMemWorkspacePaths,
  retrievalProfile: RetrievalProfile,
  scopeId: string,
  question: string,
  questionDate: string | undefined,
  modelOptions: LoadPiModelRuntimeOptions,
  skill: PiMemSkill = "pimem-v0",
): Promise<PiMemResult> {
  const rawStore = await MemoryStore.create(paths.database);
  try {
    const modelRuntime = await loadPiModelRuntime(modelOptions);
    const retrieval = createRetrievalContext(rawStore, retrievalProfile);
    return await runPiMem({
      store: retrieval.store,
      operatorRegistry: retrieval.operatorRegistry,
      modelRuntime,
      scopeId,
      question,
      ...(questionDate === undefined ? {} : { questionDate }),
      skill,
      readOnlyNavigation: createReadOnlyScopeNavigation(
        paths.sanitized,
        scopeId,
      ),
    });
  } finally {
    rawStore.close();
  }
}
