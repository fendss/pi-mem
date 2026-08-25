import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export interface PrivateBenchmarkQuestion {
  questionId: string;
}

export async function readPrivateBenchmarkQuestions<
  T extends PrivateBenchmarkQuestion,
>(path: string): Promise<T[]> {
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
    .map((line) => JSON.parse(line) as T);
}

/**
 * Atomically merges private benchmark labels by question identity.
 *
 * Several questions may intentionally share one memory scope. Keying by scope
 * would silently drop multiple AMA-Bench questions from the same episode.
 */
export async function mergePrivateBenchmarkQuestions<
  T extends PrivateBenchmarkQuestion,
>(path: string, incoming: readonly T[]): Promise<void> {
  const byQuestion = new Map<string, T>();
  for (const question of await readPrivateBenchmarkQuestions<T>(path)) {
    byQuestion.set(question.questionId, question);
  }
  for (const question of incoming) {
    const questionId = question.questionId.trim();
    if (!questionId) throw new Error("Private question ID must not be empty");
    const existing = byQuestion.get(questionId);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(question)
    ) {
      throw new Error(
        `Private benchmark question changed for immutable ID ${questionId}`,
      );
    }
    byQuestion.set(questionId, question);
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  const serialized =
    [...byQuestion.values()]
      .sort((left, right) => left.questionId.localeCompare(right.questionId))
      .map((question) => JSON.stringify(question))
      .join("\n") + "\n";
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}
