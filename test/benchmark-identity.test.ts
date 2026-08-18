import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongMemEvalPrivateQuestion } from "../src/benchmark/longmemeval/dataset-adapter.js";
import {
  benchmarkCorpusHash,
  benchmarkQuestionSetHash,
  benchmarkSourceRevision,
} from "../src/entrypoints/cli/commands/benchmark-longmemeval.js";
import { safePathSegment } from "../src/util.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

function question(overrides: Partial<LongMemEvalPrivateQuestion> = {}):
  LongMemEvalPrivateQuestion {
  return {
    questionId: "question-1",
    scopeId: "scope-1",
    question: "What color is the bicycle?",
    questionDate: "2026-01-01",
    ...overrides,
  };
}

describe("benchmark run identity", () => {
  it("hashes complete question identity rather than IDs alone", () => {
    const original = benchmarkQuestionSetHash([question()]);
    expect(benchmarkQuestionSetHash([question()])).toBe(original);
    expect(benchmarkQuestionSetHash([
      question({ question: "What color is the car?" }),
    ])).not.toBe(original);
    expect(benchmarkQuestionSetHash([
      question({ questionDate: "2026-01-02" }),
    ])).not.toBe(original);
  });

  it("binds the manifest to sanitized memory corpus contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pimem-corpus-"));
    temporaryDirectories.push(root);
    const scopePath = join(root, safePathSegment("scope-1"));
    await mkdir(scopePath, { recursive: true });
    const memoryPath = join(scopePath, "memory.jsonl");
    await writeFile(memoryPath, '{"memoryId":"m1","content":"blue"}\n');
    const original = await benchmarkCorpusHash(root, [question()]);

    await writeFile(memoryPath, '{"memoryId":"m1","content":"green"}\n');
    expect(await benchmarkCorpusHash(root, [question()])).not.toBe(original);
  });

  it("reports a git revision when available without hiding dirty state", () => {
    const revision = benchmarkSourceRevision();
    expect(revision.commit).toMatch(/^(?:[a-f0-9]{40}|unavailable)$/u);
    expect([true, false, null]).toContain(revision.dirty);
  });

  it("accepts an explicit build identity when Git is absent at runtime", () => {
    vi.stubEnv("PIMEM_SOURCE_COMMIT", "a".repeat(40));
    vi.stubEnv("PIMEM_SOURCE_DIRTY", "true");
    vi.stubEnv("PIMEM_SOURCE_FINGERPRINT", "b".repeat(64));

    expect(benchmarkSourceRevision()).toEqual({
      commit: "a".repeat(40),
      dirty: true,
      fingerprint: "b".repeat(64),
    });
  });
});
