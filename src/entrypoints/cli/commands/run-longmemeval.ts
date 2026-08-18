import { runBenchmarkAnswer } from "../../../benchmark/answer-from-evidence.js";
import { dataPaths } from "../../../benchmark/longmemeval/data-paths.js";
import { buildLongMemEvalAnswerPrompt } from "../../../benchmark/longmemeval/dataset-adapter.js";
import { readPrivateQuestions } from "../../../benchmark/longmemeval/private-question-store.js";
import { runQuestionWithRuntime } from "../../../benchmark/use-cases/run-question.js";
import { createRetrievalContext } from "../../../composition/create-retrieval-context.js";
import { loadPiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../../../platform/sqlite/pimem-store.js";
import {
  assertOnlyFlags,
  modelOptionsFor,
  requiredFlag,
  retrievalProfileFor,
  skillFor,
  type ParsedCommand,
} from "../parse-command.js";

export async function runLongMemEval(parsed: ParsedCommand): Promise<void> {
  assertOnlyFlags(parsed, [
    "data-dir",
    "question-id",
    "retrieval-profile",
    "agent-dir",
    "provider",
    "model",
    "thinking-level",
    "api-key-env",
    "base-url-env",
    "transport",
    "skill",
  ]);
  const paths = dataPaths(requiredFlag(parsed, "data-dir"));
  const questionId = requiredFlag(parsed, "question-id");
  const questions = await readPrivateQuestions(paths.privateQuestions);
  const question = questions.find((item) => item.questionId === questionId);
  if (!question) {
    throw new Error("Question is not present in the private runner map");
  }
  const rawStore = await MemoryStore.create(paths.database);
  try {
    const modelRuntime = await loadPiModelRuntime(modelOptionsFor(parsed));
    const context = createRetrievalContext(
      rawStore,
      retrievalProfileFor(parsed),
    );
    const retrieval = await runQuestionWithRuntime(
      paths,
      context.store,
      context.operatorRegistry,
      modelRuntime,
      question.scopeId,
      question.question,
      question.questionDate,
      { skill: skillFor(parsed) },
    );
    const answer = await runBenchmarkAnswer({
      modelRuntime,
      prompt: buildLongMemEvalAnswerPrompt(question.question, retrieval),
    });
    process.stdout.write(
      `${JSON.stringify({ questionId, retrieval, answer }, null, 2)}\n`,
    );
  } finally {
    rawStore.close();
  }
}
