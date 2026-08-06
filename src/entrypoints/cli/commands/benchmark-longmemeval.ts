import { chmod, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  runBenchmarkAnswer,
  type BenchmarkAnswerResult,
} from "../../../benchmark/answer-from-evidence.js";
import type {
  BenchmarkFailureRecord,
  BenchmarkPrediction,
  BenchmarkSuccessRecord,
} from "../../../benchmark/model/benchmark-run.js";
import { dataPaths } from "../../../benchmark/longmemeval/data-paths.js";
import {
  buildLongMemEvalAnswerPrompt,
  LONGMEMEVAL_ANSWER_PROMPT_TEMPLATE,
  LONGMEMEVAL_ANSWER_PROMPT_VERSION,
  type LongMemEvalPrivateQuestion,
} from "../../../benchmark/longmemeval/dataset-adapter.js";
import { readPrivateQuestions } from "../../../benchmark/longmemeval/private-question-store.js";
import { runQuestionWithRuntime } from "../../../benchmark/use-cases/run-question.js";
import { createRetrievalContext } from "../../../composition/create-retrieval-context.js";
import {
  PI_MEM_SYSTEM_PROMPT,
  PIMEM_HARNESS_VERSION,
  PiMemRunError,
  type PiMemResult,
} from "../../../evidence-agent/index.js";
import { runAsyncPool } from "../../../platform/concurrency/async-pool.js";
import { loadPiModelRuntime } from "../../../platform/pi/load-model-runtime.js";
import { MemoryStore } from "../../../platform/sqlite/pimem-store.js";
import { embeddingProfile } from "../../../retrieval/index-scope-embeddings.js";
import type { RetrievalMetadata } from "../../../retrieval/index.js";
import { safePathSegment, sha256 } from "../../../util.js";
import {
  assertOnlyFlags,
  modelOptionsFor,
  positiveIntegerFlag,
  requiredFlag,
  retrievalProfileFor,
  type ParsedCommand,
} from "../parse-command.js";
import {
  readJsonFileIfPresent,
  writeAtomicJson,
  writeAtomicText,
} from "../workflow-files.js";

const BENCHMARK_MAX_RUN_MS = 300_000;
const BENCHMARK_MAX_TURNS = 64;
const BENCHMARK_MAX_TOOL_CALLS = 80;

function successRecordPath(recordsDir: string, questionId: string): string {
  return join(recordsDir, `${safePathSegment(questionId)}.json`);
}

function failureRecordPath(failuresDir: string, questionId: string): string {
  return join(failuresDir, `${safePathSegment(questionId)}.json`);
}

async function completedQuestionIds(path: string): Promise<Set<string>> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
  const ids = new Set<string>();
  for (const line of serialized.split("\n").filter(Boolean)) {
    const item = JSON.parse(line) as Record<string, unknown>;
    if (typeof item.question_id === "string") ids.add(item.question_id);
  }
  return ids;
}

function predictionFor(
  retrieval: PiMemResult,
  answer: BenchmarkAnswerResult,
  questionId: string,
): BenchmarkPrediction {
  return {
    question_id: questionId,
    response: answer.answer,
    abstention: retrieval.status === "insufficient",
    retrieval_status: retrieval.status,
    citations: retrieval.citations,
    ...(retrieval.count === undefined ? {} : { count: retrieval.count }),
    ...(retrieval.inventory === undefined
      ? {}
      : { inventory: retrieval.inventory }),
    metrics: retrieval.metrics,
    retrieval: retrieval.retrieval,
    retrieval_model: retrieval.retrievalModel,
    answer_model: answer.model,
    answer_prompt: {
      adapter: answer.promptAdapter,
      version: answer.promptVersion,
      hash: answer.promptHash,
    },
    run_id: retrieval.runId,
  };
}

async function ensureBenchmarkManifest(
  path: string,
  config: Record<string, unknown>,
): Promise<void> {
  const existing = await readJsonFileIfPresent<{
    schema_version: number;
    config: Record<string, unknown>;
  }>(path);
  if (existing) {
    if (
      existing.schema_version !== 1 ||
      JSON.stringify(existing.config) !== JSON.stringify(config)
    ) {
      throw new Error(
        "Benchmark output directory has a different run configuration",
      );
    }
    return;
  }
  await writeAtomicJson(path, {
    schema_version: 1,
    created_at: new Date().toISOString(),
    config,
  });
}

async function loadSuccessRecords(
  recordsDir: string,
  questions: readonly LongMemEvalPrivateQuestion[],
): Promise<Map<string, BenchmarkSuccessRecord>> {
  const records = new Map<string, BenchmarkSuccessRecord>();
  for (const question of questions) {
    const record = await readJsonFileIfPresent<BenchmarkSuccessRecord>(
      successRecordPath(recordsDir, question.questionId),
    );
    if (!record) continue;
    if (
      record.schema_version !== 2 ||
      record.question_id !== question.questionId
    ) {
      throw new Error(`Invalid benchmark record: ${question.questionId}`);
    }
    records.set(question.questionId, record);
  }
  return records;
}

async function readJsonlMap(path: string): Promise<Map<string, unknown>> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
  const values = new Map<string, unknown>();
  for (const line of serialized.split("\n").filter(Boolean)) {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (typeof value.question_id === "string") {
      values.set(value.question_id, value);
    }
  }
  return values;
}

async function materializeBenchmarkArtifacts(
  outputDir: string,
  selected: readonly LongMemEvalPrivateQuestion[],
): Promise<{ succeeded: number; failed: number }> {
  const recordsDir = join(outputDir, "records");
  const failureRecordsDir = join(outputDir, "failure-records");
  const [successes, legacyPredictions, legacyTraces] = await Promise.all([
    loadSuccessRecords(recordsDir, selected),
    readJsonlMap(join(outputDir, "predictions.jsonl")),
    readJsonlMap(join(outputDir, "traces.jsonl")),
  ]);
  const records: BenchmarkSuccessRecord[] = [];
  const predictions: unknown[] = [];
  const traces: unknown[] = [];
  const failures: BenchmarkFailureRecord[] = [];
  for (const question of selected) {
    const success = successes.get(question.questionId);
    if (success) {
      records.push(success);
      predictions.push(success.prediction);
      traces.push({
        question_id: success.question_id,
        retrieval: success.retrieval,
        answer: success.answer,
      });
      continue;
    }
    const legacyPrediction = legacyPredictions.get(question.questionId);
    if (legacyPrediction) {
      predictions.push(legacyPrediction);
      const legacyTrace = legacyTraces.get(question.questionId);
      if (legacyTrace) traces.push(legacyTrace);
      continue;
    }
    const failure = await readJsonFileIfPresent<BenchmarkFailureRecord>(
      failureRecordPath(failureRecordsDir, question.questionId),
    );
    if (failure) failures.push(failure);
  }

  const serializedPredictions = predictions
    .map((value) => JSON.stringify(value))
    .join("\n");
  const serializedTraces = traces
    .map((value) => JSON.stringify(value))
    .join("\n");
  const serializedFailures = failures
    .map((failure) => JSON.stringify(failure))
    .join("\n");
  await Promise.all([
    writeAtomicText(
      join(outputDir, "predictions.jsonl"),
      serializedPredictions.length === 0 ? "" : `${serializedPredictions}\n`,
    ),
    writeAtomicText(
      join(outputDir, "traces.jsonl"),
      serializedTraces.length === 0 ? "" : `${serializedTraces}\n`,
    ),
    writeAtomicText(
      join(outputDir, "failures.jsonl"),
      serializedFailures.length === 0 ? "" : `${serializedFailures}\n`,
    ),
    writeAtomicJson(join(outputDir, "results.json"), {
      schema_version: 1,
      result_count: records.length,
      results: records,
    }),
  ]);
  return { succeeded: predictions.length, failed: failures.length };
}

function systemicRuntimeFailure(message: string): boolean {
  return /(?:status code|HTTP \d{3}|API error|rate limit|fetch failed|ECONN|ETIMEDOUT|401|403|429)/iu.test(
    message,
  );
}

export async function benchmarkLongMemEval(
  parsed: ParsedCommand,
): Promise<void> {
  assertOnlyFlags(parsed, [
    "data-dir",
    "output-dir",
    "question-id",
    "retrieval-profile",
    "slots",
    "agent-dir",
    "provider",
    "model",
    "thinking-level",
    "api-key-env",
    "base-url-env",
    "transport",
  ]);
  const paths = dataPaths(requiredFlag(parsed, "data-dir"));
  const outputDir = resolve(requiredFlag(parsed, "output-dir"));
  const retrievalProfile = retrievalProfileFor(parsed);
  const slots = positiveIntegerFlag(parsed, "slots", 1, 256);
  const requestedIds = new Set(parsed.flags.get("question-id") ?? []);
  const privateQuestions = await readPrivateQuestions(paths.privateQuestions);
  const selected =
    requestedIds.size === 0
      ? privateQuestions
      : privateQuestions.filter((question) =>
          requestedIds.has(question.questionId),
        );
  if (requestedIds.size > 0 && selected.length !== requestedIds.size) {
    const found = new Set(selected.map((question) => question.questionId));
    const missing = [...requestedIds].filter((id) => !found.has(id));
    throw new Error(
      `Question is not present in private runner map: ${missing.join(", ")}`,
    );
  }
  if (selected.length === 0) throw new Error("No benchmark questions selected");

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const recordsDir = join(outputDir, "records");
  const failureRecordsDir = join(outputDir, "failure-records");
  await Promise.all([
    mkdir(recordsDir, { recursive: true, mode: 0o700 }),
    mkdir(failureRecordsDir, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    chmod(recordsDir, 0o700),
    chmod(failureRecordsDir, 0o700),
  ]);

  const records = await loadSuccessRecords(recordsDir, selected);
  const legacyCompleted = await completedQuestionIds(
    join(outputDir, "predictions.jsonl"),
  );
  const completed = new Set([...legacyCompleted, ...records.keys()]);
  const pending = selected.filter(
    (question) => !completed.has(question.questionId),
  );
  const rawStore = await MemoryStore.create(paths.database);
  let succeededNow = 0;
  let failedNow = 0;
  let notStarted = 0;
  let settled = 0;
  let halted = false;
  let retrieval: RetrievalMetadata = { retrievalProfile: "fts5" };
  try {
    const modelRuntime = await loadPiModelRuntime(modelOptionsFor(parsed));
    const contextCount = Math.max(
      1,
      Math.min(slots, Math.max(1, pending.length)),
    );
    const retrievalContexts = Array.from({ length: contextCount }, () =>
      createRetrievalContext(rawStore, retrievalProfile),
    );
    retrieval = retrievalContexts[0]!.metadata;

    if (retrievalProfile === "pimem-hybrid") {
      const profile = embeddingProfile(retrievalContexts[0]!.embedder!);
      let total = 0;
      let indexed = 0;
      for (const question of selected) {
        const status = rawStore.getEmbeddingIndexStatus(question.scopeId, profile);
        total += status.total;
        indexed += status.indexed;
        if (status.total === 0 || status.missing !== 0) {
          throw new Error(
            `Benchmark embedding preflight failed for scope ${question.scopeId}: ` +
              `${status.indexed}/${status.total} indexed`,
          );
        }
      }
      process.stderr.write(`Embedding preflight: ${indexed}/${total} indexed\n`);
    }

    const configuredModel = {
      providerId: modelRuntime.providerId,
      modelId: modelRuntime.modelId,
      thinkingLevel: modelRuntime.thinkingLevel,
      transport: modelRuntime.transport,
    };
    await ensureBenchmarkManifest(join(outputDir, "run-manifest.json"), {
      benchmark: "LongMemEval-S",
      question_count: selected.length,
      question_set_hash: sha256(
        JSON.stringify(selected.map((question) => question.questionId).sort()),
      ),
      retrieval,
      retrieval_model: configuredModel,
      answer_model: configuredModel,
      answer_prompt: {
        adapter: "longmemeval-s",
        version: LONGMEMEVAL_ANSWER_PROMPT_VERSION,
        template_hash: sha256(LONGMEMEVAL_ANSWER_PROMPT_TEMPLATE),
      },
      slots,
      harness_version: PIMEM_HARNESS_VERSION,
      retrieval_system_prompt_hash: sha256(PI_MEM_SYSTEM_PROMPT),
      max_run_ms: BENCHMARK_MAX_RUN_MS,
      max_turns: BENCHMARK_MAX_TURNS,
      max_tool_calls: BENCHMARK_MAX_TOOL_CALLS,
    });

    const runOne = async (
      question: LongMemEvalPrivateQuestion,
      slot: number,
    ): Promise<void> => {
      if (halted) {
        notStarted += 1;
        return;
      }
      try {
        const retrievalResult = await runQuestionWithRuntime(
          paths,
          retrievalContexts[slot - 1]!.store,
          modelRuntime,
          question.scopeId,
          question.question,
          question.questionDate,
          {
            maxRunMs: BENCHMARK_MAX_RUN_MS,
            maxTurns: BENCHMARK_MAX_TURNS,
            maxToolCalls: BENCHMARK_MAX_TOOL_CALLS,
          },
        );
        const answerResult = await runBenchmarkAnswer({
          modelRuntime,
          prompt: buildLongMemEvalAnswerPrompt(
            question.question,
            retrievalResult,
          ),
          maxRunMs: BENCHMARK_MAX_RUN_MS,
        });
        const record: BenchmarkSuccessRecord = {
          schema_version: 2,
          question_id: question.questionId,
          slot,
          prediction: predictionFor(
            retrievalResult,
            answerResult,
            question.questionId,
          ),
          retrieval: retrievalResult,
          answer: answerResult,
        };
        await writeAtomicJson(
          successRecordPath(recordsDir, question.questionId),
          record,
        );
        succeededNow += 1;
      } catch (error) {
        failedNow += 1;
        const message = error instanceof Error ? error.message : String(error);
        const failure: BenchmarkFailureRecord = {
          schema_version: 1,
          question_id: question.questionId,
          slot,
          error: message,
          ...(error instanceof PiMemRunError
            ? { diagnostics: error.diagnostics }
            : {}),
        };
        await writeAtomicJson(
          failureRecordPath(failureRecordsDir, question.questionId),
          failure,
        );
        if (systemicRuntimeFailure(message)) halted = true;
      } finally {
        settled += 1;
        process.stderr.write(
          `[slot ${slot}] [${settled}/${pending.length}] ${question.questionId}: ` +
            `${halted ? "halt-check" : "settled"}\n`,
        );
      }
    };

    const canaryCount = slots > 4 ? Math.min(4, pending.length) : 0;
    if (canaryCount > 0) {
      await runAsyncPool(
        pending.slice(0, canaryCount),
        canaryCount,
        async (question, context) => runOne(question, context.slot),
      );
    }
    if (!halted) {
      await runAsyncPool(
        pending.slice(canaryCount),
        slots,
        async (question, context) => runOne(question, context.slot),
      );
    } else {
      notStarted += pending.length - canaryCount;
    }
  } finally {
    rawStore.close();
  }

  const materialized = await materializeBenchmarkArtifacts(outputDir, selected);
  const predictionsPath = join(outputDir, "predictions.jsonl");
  const tracesPath = join(outputDir, "traces.jsonl");
  const failuresPath = join(outputDir, "failures.jsonl");
  process.stdout.write(
    `${JSON.stringify({
      command: "benchmark-longmemeval",
      retrieval,
      slots,
      selected: selected.length,
      skipped: selected.length - pending.length,
      succeededNow,
      failedNow,
      notStarted,
      totalSucceeded: materialized.succeeded,
      totalFailed: materialized.failed,
      halted,
      predictionsPath,
      tracesPath,
      resultsPath: join(outputDir, "results.json"),
      failuresPath: materialized.failed > 0 ? failuresPath : null,
    }, null, 2)}\n`,
  );
  if (failedNow > 0 || halted) process.exitCode = 1;
}
