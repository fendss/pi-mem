import {
  runQuestionWithRuntime,
} from "../benchmark/use-cases/run-question.js";
import type { LongMemEvalDataPaths } from "../benchmark/longmemeval/data-paths.js";
import type { PiMemResult, PiMemSkill } from "../evidence-agent/index.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
} from "../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../platform/sqlite/pimem-store.js";
import type { RetrievalProfile } from "../retrieval/index.js";
import { createRetrievalContext } from "./create-retrieval-context.js";

export async function runQuestion(
  paths: LongMemEvalDataPaths,
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
    return await runQuestionWithRuntime(
      paths,
      retrieval.store,
      retrieval.operatorRegistry,
      modelRuntime,
      scopeId,
      question,
      questionDate,
      { skill },
    );
  } finally {
    rawStore.close();
  }
}
