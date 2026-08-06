import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import type { LongMemEvalPrivateQuestion } from "./dataset-adapter.js";

export async function readPrivateQuestions(
  path: string,
): Promise<LongMemEvalPrivateQuestion[]> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  return serialized
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LongMemEvalPrivateQuestion);
}

export async function mergePrivateQuestions(
  path: string,
  incoming: readonly LongMemEvalPrivateQuestion[],
): Promise<void> {
  const byScope = new Map<string, LongMemEvalPrivateQuestion>();
  for (const question of await readPrivateQuestions(path)) {
    byScope.set(question.scopeId, question);
  }
  for (const question of incoming) {
    const existing = byScope.get(question.scopeId);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(question)
    ) {
      throw new Error(
        `Private question mapping changed for immutable scope ${question.scopeId}`,
      );
    }
    byScope.set(question.scopeId, question);
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  const serialized =
    [...byScope.values()]
      .sort((left, right) => left.scopeId.localeCompare(right.scopeId))
      .map((question) => JSON.stringify(question))
      .join("\n") + "\n";
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}
