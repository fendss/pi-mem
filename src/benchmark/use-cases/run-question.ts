import { join } from "node:path";
import { createRetrievalContext } from "../../composition/create-retrieval-context.js";
import {
  runPiMem,
  type PiMemResult,
  type PiMemRuntimeStore,
} from "../../evidence-agent/index.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
  type PiModelRuntime,
} from "../../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../../platform/sqlite/pimem-store.js";
import type { RetrievalProfile } from "../../retrieval/index.js";
import { safePathSegment } from "../../util.js";
import type { LongMemEvalDataPaths } from "../longmemeval/data-paths.js";

export async function runQuestion(
  paths: LongMemEvalDataPaths,
  retrievalProfile: RetrievalProfile,
  scopeId: string,
  question: string,
  questionDate: string | undefined,
  modelOptions: LoadPiModelRuntimeOptions,
): Promise<PiMemResult> {
  const rawStore = await MemoryStore.create(paths.database);
  try {
    const modelRuntime = await loadPiModelRuntime(modelOptions);
    const retrieval = createRetrievalContext(rawStore, retrievalProfile);
    return await runQuestionWithRuntime(
      paths,
      retrieval.store,
      modelRuntime,
      scopeId,
      question,
      questionDate,
    );
  } finally {
    rawStore.close();
  }
}

export async function runQuestionWithRuntime(
  paths: LongMemEvalDataPaths,
  store: PiMemRuntimeStore,
  modelRuntime: PiModelRuntime,
  scopeId: string,
  question: string,
  questionDate?: string,
  runtimeLimits: {
    maxRunMs?: number;
    maxTurns?: number;
    maxToolCalls?: number;
  } = {},
): Promise<PiMemResult> {
  return runPiMem({
    store,
    modelRuntime,
    scopeId,
    question,
    ...(questionDate === undefined ? {} : { questionDate }),
    ...runtimeLimits,
    scopePath: join(paths.sanitized, safePathSegment(scopeId)),
  });
}
