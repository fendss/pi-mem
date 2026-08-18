import { dataPaths } from "../../../benchmark/longmemeval/data-paths.js";
import { runQuestion } from "../../../composition/run-question.js";
import {
  assertOnlyFlags,
  modelOptionsFor,
  optionalFlag,
  requiredFlag,
  retrievalProfileFor,
  skillFor,
  type ParsedCommand,
} from "../parse-command.js";

export async function runGeneric(parsed: ParsedCommand): Promise<void> {
  assertOnlyFlags(parsed, [
    "data-dir",
    "scope",
    "question",
    "question-date",
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
  const result = await runQuestion(
    dataPaths(requiredFlag(parsed, "data-dir")),
    retrievalProfileFor(parsed),
    requiredFlag(parsed, "scope"),
    requiredFlag(parsed, "question"),
    optionalFlag(parsed, "question-date"),
    modelOptionsFor(parsed),
    skillFor(parsed),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
