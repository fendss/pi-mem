import { join } from "node:path";
import {
  runPiMem,
  type PiMemResult,
  type PiMemRuntimeStore,
  type RunPiMemOptions,
} from "../../evidence-agent/index.js";
import { safePathSegment } from "../../util.js";
import type { LongMemEvalDataPaths } from "../longmemeval/data-paths.js";

export async function runQuestionWithRuntime(
  paths: LongMemEvalDataPaths,
  store: PiMemRuntimeStore,
  modelRuntime: RunPiMemOptions["modelRuntime"],
  scopeId: string,
  question: string,
  questionDate?: string,
  runtimeOptions: Pick<
    RunPiMemOptions,
    "maxRunMs" | "maxTurns" | "maxToolCalls" | "skill"
  > = {},
): Promise<PiMemResult> {
  return runPiMem({
    store,
    modelRuntime,
    scopeId,
    question,
    ...(questionDate === undefined ? {} : { questionDate }),
    ...runtimeOptions,
    scopePath: join(paths.sanitized, safePathSegment(scopeId)),
  });
}
