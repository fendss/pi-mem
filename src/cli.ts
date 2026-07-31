#!/usr/bin/env node
import {
  execFile,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildLongMemEvalAnswerPrompt,
  loadLongMemEvalS,
  LONGMEMEVAL_ANSWER_PROMPT_TEMPLATE,
  LONGMEMEVAL_ANSWER_PROMPT_VERSION,
  type LongMemEvalPrivateQuestion,
} from "./adapters/longmemeval.js";
import {
  runBenchmarkAnswer,
  type BenchmarkAnswerResult,
} from "./benchmark-answer.js";
import {
  type Embedder,
  OpenAICompatibleEmbedder,
} from "./embedding.js";
import {
  embeddingProfile,
  indexScopeEmbeddings,
  type EmbeddingIndexResult,
} from "./embedding-index.js";
import { HybridMemoryStore } from "./hybrid-search.js";
import { ingestMemorySessions } from "./ingest.js";
import { runAsyncPool } from "./async-pool.js";
import {
  loadPiModelRuntime,
  type LoadPiModelRuntimeOptions,
  type PiModelRuntime,
} from "./model.js";
import {
  loadProtectedEnvironment,
  requireEnvironmentVariable,
} from "./protected-env.js";
import { AsyncRequestGate } from "./request-gate.js";
import {
  parseRetrievalProfile,
} from "./retrieval-profile.js";
import {
  PI_MEM_SYSTEM_PROMPT,
  PIMEM_HARNESS_VERSION,
  PiMemRunError,
  runPiMem,
  type PiMemRuntimeStore,
} from "./runtime.js";
import { MemoryStore } from "./store.js";
import type {
  PiMemResult,
  RetrievalMetadata,
  RetrievalProfile,
} from "./types.js";
import { safePathSegment, sha256 } from "./util.js";

interface ParsedCommand {
  command: string;
  flags: Map<string, string[]>;
}

function parseCommand(argv: string[]): ParsedCommand {
  const [command, ...tokens] = argv;
  if (!command) return { command: "help", flags: new Map() };
  const flags = new Map<string, string[]>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${String(token)}`);
    }
    const name = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    const bucket = flags.get(name) ?? [];
    bucket.push(value);
    flags.set(name, bucket);
    index += 1;
  }
  return { command, flags };
}

function requiredFlag(parsed: ParsedCommand, name: string): string {
  const values = parsed.flags.get(name);
  if (!values || values.length !== 1 || !values[0]?.trim()) {
    throw new Error(`Expected exactly one --${name}`);
  }
  return values[0];
}

function optionalFlag(
  parsed: ParsedCommand,
  name: string,
): string | undefined {
  const values = parsed.flags.get(name);
  if (values === undefined) return undefined;
  if (values.length !== 1 || !values[0]?.trim()) {
    throw new Error(`Expected at most one --${name}`);
  }
  return values[0];
}

function positiveIntegerFlag(
  parsed: ParsedCommand,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = optionalFlag(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`--${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function positiveNumberFlag(
  parsed: ParsedCommand,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = optionalFlag(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`--${name} must be greater than 0 and at most ${maximum}`);
  }
  return value;
}

function modelOptionsFor(parsed: ParsedCommand): LoadPiModelRuntimeOptions {
  const agentDir = optionalFlag(parsed, "agent-dir");
  const providerId = optionalFlag(parsed, "provider");
  const modelId = optionalFlag(parsed, "model");
  const thinkingLevel = optionalFlag(parsed, "thinking-level");
  const apiKeyEnv = optionalFlag(parsed, "api-key-env");
  const baseUrlEnv = optionalFlag(parsed, "base-url-env");
  const acceptedThinkingLevels = new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  if (
    thinkingLevel !== undefined &&
    !acceptedThinkingLevels.has(thinkingLevel)
  ) {
    throw new Error(`Unknown thinking level: ${thinkingLevel}`);
  }
  const baseUrl = baseUrlEnv === undefined
    ? undefined
    : requireEnvironmentVariable(process.env, baseUrlEnv);
  if (apiKeyEnv !== undefined) {
    requireEnvironmentVariable(process.env, apiKeyEnv);
  }
  return {
    ...(agentDir === undefined ? {} : { agentDir: resolve(agentDir) }),
    ...(providerId === undefined ? {} : { providerId }),
    ...(modelId === undefined ? {} : { modelId }),
    ...(thinkingLevel === undefined
      ? {}
      : {
          thinkingLevel:
            thinkingLevel as NonNullable<
              LoadPiModelRuntimeOptions["thinkingLevel"]
            >,
        }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

function assertOnlyFlags(
  parsed: ParsedCommand,
  allowed: readonly string[],
): void {
  const accepted = new Set(allowed);
  for (const name of parsed.flags.keys()) {
    if (!accepted.has(name)) throw new Error(`Unknown flag: --${name}`);
  }
}

function retrievalProfileFor(parsed: ParsedCommand): RetrievalProfile {
  return parseRetrievalProfile(optionalFlag(parsed, "retrieval-profile"));
}

interface RetrievalContext {
  store: PiMemRuntimeStore;
  metadata: RetrievalMetadata;
  embedder?: Embedder;
}

function createRetrievalContext(
  rawStore: MemoryStore,
  profile: RetrievalProfile,
  embedder?: Embedder,
): RetrievalContext {
  if (profile === "fts5") {
    return { store: rawStore, metadata: { retrievalProfile: "fts5" } };
  }
  const selectedEmbedder =
    embedder ?? OpenAICompatibleEmbedder.fromEnvironment();
  const store = new HybridMemoryStore(rawStore, selectedEmbedder);
  return {
    store,
    metadata: store.getRetrievalMetadata(),
    embedder: selectedEmbedder,
  };
}

function dataPaths(dataDir: string): {
  database: string;
  sanitized: string;
  privateQuestions: string;
} {
  const root = resolve(dataDir);
  return {
    database: join(root, "memory.sqlite"),
    sanitized: join(root, "sanitized"),
    privateQuestions: join(root, "private", "questions.jsonl"),
  };
}

async function readPrivateQuestions(
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

async function mergePrivateQuestions(
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

async function ingestLongMemEval(parsed: ParsedCommand): Promise<void> {
  assertOnlyFlags(parsed, [
    "source",
    "data-dir",
    "question-id",
    "retrieval-profile",
    "embedding-slots",
    "embedding-rps",
  ]);
  const source = resolve(requiredFlag(parsed, "source"));
  const paths = dataPaths(requiredFlag(parsed, "data-dir"));
  const retrievalProfile = retrievalProfileFor(parsed);
  const embeddingSlots = positiveIntegerFlag(parsed, "embedding-slots", 1, 128);
  const embeddingRequestsPerSecond = positiveNumberFlag(
    parsed,
    "embedding-rps",
    6,
    100,
  );
  if (
    retrievalProfile === "fts5" &&
    (parsed.flags.has("embedding-slots") || parsed.flags.has("embedding-rps"))
  ) {
    throw new Error("Embedding concurrency flags require pimem-hybrid");
  }
  const requestedIds = new Set(parsed.flags.get("question-id") ?? []);
  const adapted = await loadLongMemEvalS(source);

  const selectedQuestions =
    requestedIds.size === 0
      ? adapted.privateQuestions
      : adapted.privateQuestions.filter((question) =>
          requestedIds.has(question.questionId),
        );
  if (
    requestedIds.size > 0 &&
    selectedQuestions.length !== requestedIds.size
  ) {
    const found = new Set(
      selectedQuestions.map((question) => question.questionId),
    );
    const missing = [...requestedIds].filter((id) => !found.has(id));
    throw new Error(`Unknown LongMemEval question ID: ${missing.join(", ")}`);
  }

  const selectedScopes = new Set(
    selectedQuestions.map((question) => question.scopeId),
  );
  const sessions = adapted.memorySessions.filter((session) =>
    selectedScopes.has(session.scopeId),
  );
  const store = await MemoryStore.create(paths.database);
  try {
    const results = await ingestMemorySessions(store, sessions, {
      exportRoot: paths.sanitized,
    });
    let retrieval: RetrievalMetadata = { retrievalProfile: "fts5" };
    let embeddingIndexes: EmbeddingIndexResult[] = [];
    if (retrievalProfile === "pimem-hybrid") {
      const requestGate = new AsyncRequestGate(
        embeddingSlots,
        embeddingRequestsPerSecond,
      );
      const embedders = Array.from({ length: embeddingSlots }, () =>
        OpenAICompatibleEmbedder.fromEnvironment(
          process.env,
          undefined,
          requestGate,
        ),
      );
      const profile = embeddingProfile(embedders[0]!);
      retrieval = {
        retrievalProfile,
        embeddingProfileId: profile.profileId,
        embeddingModel: profile.model,
        embeddingDimensions: profile.dimensions,
      };
      let firstError: unknown;
      let halted = false;
      let settledScopes = 0;
      const indexes = await runAsyncPool(
        results,
        embeddingSlots,
        async (result, context): Promise<EmbeddingIndexResult | undefined> => {
          if (halted) return undefined;
          try {
            return await indexScopeEmbeddings(
              store,
              result.scopeId,
              embedders[context.slot - 1]!,
            );
          } catch (error) {
            firstError ??= error;
            halted = true;
            return undefined;
          } finally {
            settledScopes += 1;
            process.stderr.write(
              `[embedding slot ${context.slot}] ` +
                `[${settledScopes}/${results.length}] ${result.scopeId}\n`,
            );
          }
        },
      );
      if (firstError !== undefined) throw firstError;
      embeddingIndexes = indexes.filter(
        (index): index is EmbeddingIndexResult => index !== undefined,
      );
    }
    await mergePrivateQuestions(paths.privateQuestions, selectedQuestions);
    process.stdout.write(
      `${JSON.stringify({
        command: "ingest-longmemeval",
        retrieval,
        ...(retrievalProfile === "pimem-hybrid"
          ? {
              embeddingConcurrency: {
                slots: embeddingSlots,
                requestsPerSecond: embeddingRequestsPerSecond,
              },
            }
          : {}),
        scopes: results,
        embeddingIndexes,
        privateQuestionCount: selectedQuestions.length,
      }, null, 2)}\n`,
    );
  } finally {
    store.close();
  }
}

async function runQuestion(
  paths: ReturnType<typeof dataPaths>,
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
      rawStore,
      modelRuntime,
      scopeId,
      question,
      questionDate,
    );
  } finally {
    rawStore.close();
  }
}

async function runQuestionWithRuntime(
  paths: ReturnType<typeof dataPaths>,
  store: PiMemRuntimeStore,
  bashStore: Pick<MemoryStore, "findMentionedMemoryIds" | "getRecords">,
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
    bashStore,
    scopeId,
    question,
    ...(questionDate === undefined ? {} : { questionDate }),
    ...runtimeLimits,
    scopePath: join(paths.sanitized, safePathSegment(scopeId)),
  });
}

async function runGeneric(parsed: ParsedCommand): Promise<void> {
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
  ]);
  const result = await runQuestion(
    dataPaths(requiredFlag(parsed, "data-dir")),
    retrievalProfileFor(parsed),
    requiredFlag(parsed, "scope"),
    requiredFlag(parsed, "question"),
    optionalFlag(parsed, "question-date"),
    modelOptionsFor(parsed),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runLongMemEval(parsed: ParsedCommand): Promise<void> {
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
  ]);
  const paths = dataPaths(requiredFlag(parsed, "data-dir"));
  const questionId = requiredFlag(parsed, "question-id");
  const questions = await readPrivateQuestions(paths.privateQuestions);
  const question = questions.find((item) => item.questionId === questionId);
  if (!question) {
    throw new Error(`Question is not present in the private runner map`);
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
      rawStore,
      modelRuntime,
      question.scopeId,
      question.question,
      question.questionDate,
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

const BENCHMARK_MAX_RUN_MS = 300_000;
const BENCHMARK_MAX_TURNS = 64;
const BENCHMARK_MAX_TOOL_CALLS = 80;

interface BenchmarkPrediction {
  question_id: string;
  response: string;
  abstention: boolean;
  retrieval_status: PiMemResult["status"];
  citations: PiMemResult["citations"];
  count?: number;
  inventory?: PiMemResult["inventory"];
  metrics: PiMemResult["metrics"];
  retrieval: PiMemResult["retrieval"];
  retrieval_model: PiMemResult["retrievalModel"];
  answer_model: BenchmarkAnswerResult["model"];
  answer_prompt: {
    adapter: string;
    version: string;
    hash: string;
  };
  run_id: string;
}

interface BenchmarkSuccessRecord {
  schema_version: 2;
  question_id: string;
  slot: number;
  prediction: BenchmarkPrediction;
  retrieval: PiMemResult;
  answer: BenchmarkAnswerResult;
}

interface BenchmarkFailureRecord {
  schema_version: 1;
  question_id: string;
  slot: number;
  error: string;
  diagnostics?: PiMemRunError["diagnostics"];
}

function successRecordPath(recordsDir: string, questionId: string): string {
  return join(recordsDir, `${safePathSegment(questionId)}.json`);
}

function failureRecordPath(failuresDir: string, questionId: string): string {
  return join(failuresDir, `${safePathSegment(questionId)}.json`);
}

async function writeAtomicText(path: string, serialized: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await writeAtomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFileIfPresent<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
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
    if (existing.schema_version !== 1 || JSON.stringify(existing.config) !== JSON.stringify(config)) {
      throw new Error("Benchmark output directory has a different run configuration");
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
    if (record.schema_version !== 2 || record.question_id !== question.questionId) {
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

  const serializedPredictions = predictions.map((value) => JSON.stringify(value)).join("\n");
  const serializedTraces = traces.map((value) => JSON.stringify(value)).join("\n");
  const serializedFailures = failures.map((failure) => JSON.stringify(failure)).join("\n");
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

async function benchmarkLongMemEval(parsed: ParsedCommand): Promise<void> {
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
      : privateQuestions.filter((question) => requestedIds.has(question.questionId));
  if (requestedIds.size > 0 && selected.length !== requestedIds.size) {
    const found = new Set(selected.map((question) => question.questionId));
    const missing = [...requestedIds].filter((id) => !found.has(id));
    throw new Error(`Question is not present in private runner map: ${missing.join(", ")}`);
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
  await Promise.all([chmod(recordsDir, 0o700), chmod(failureRecordsDir, 0o700)]);

  const records = await loadSuccessRecords(recordsDir, selected);
  const legacyCompleted = await completedQuestionIds(join(outputDir, "predictions.jsonl"));
  const completed = new Set([...legacyCompleted, ...records.keys()]);
  const pending = selected.filter((question) => !completed.has(question.questionId));
  const rawStore = await MemoryStore.create(paths.database);
  let succeededNow = 0;
  let failedNow = 0;
  let notStarted = 0;
  let settled = 0;
  let halted = false;
  let retrieval: RetrievalMetadata = { retrievalProfile: "fts5" };
  try {
    const modelRuntime = await loadPiModelRuntime(modelOptionsFor(parsed));
    const contextCount = Math.max(1, Math.min(slots, Math.max(1, pending.length)));
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
          rawStore,
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

async function executeFile(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error) => {
        if (error) {
          reject(new Error(`Unable to create benchmark archive with ${file}`));
          return;
        }
        resolvePromise();
      },
    );
  });
}

function jsonlRecordCount(serialized: string): number {
  return serialized.split("\n").filter(Boolean).length;
}

async function packageBenchmark(parsed: ParsedCommand): Promise<void> {
  assertOnlyFlags(parsed, ["output-dir", "archive"]);
  const outputDir = resolve(requiredFlag(parsed, "output-dir"));
  const archivePath = resolve(requiredFlag(parsed, "archive"));
  const includedFiles = [
    "run-manifest.json",
    "results.json",
    "predictions.jsonl",
    "traces.jsonl",
  ];
  for (const optional of ["suite-audit.json", "benchmark-progress.json"]) {
    try {
      const metadata = await stat(join(outputDir, optional));
      if (metadata.isFile()) includedFiles.push(optional);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  const [manifestText, resultsText, predictionsText, tracesText, failuresText] =
    await Promise.all([
      readFile(join(outputDir, includedFiles[0]!), "utf8"),
      readFile(join(outputDir, includedFiles[1]!), "utf8"),
      readFile(join(outputDir, includedFiles[2]!), "utf8"),
      readFile(join(outputDir, includedFiles[3]!), "utf8"),
      readFile(join(outputDir, "failures.jsonl"), "utf8"),
    ]);
  const manifest = JSON.parse(manifestText) as {
    config?: { question_count?: unknown };
  };
  const results = JSON.parse(resultsText) as {
    result_count?: unknown;
    results?: unknown[];
  };
  const expected = manifest.config?.question_count;
  if (!Number.isSafeInteger(expected) || expected !== results.result_count) {
    throw new Error("Benchmark results are incomplete for the manifest question set");
  }
  if (!Array.isArray(results.results) || results.results.length !== expected) {
    throw new Error("Benchmark results array is incomplete");
  }
  if (
    jsonlRecordCount(predictionsText) !== expected ||
    jsonlRecordCount(tracesText) !== expected
  ) {
    throw new Error("Benchmark JSONL artifacts are incomplete");
  }
  if (jsonlRecordCount(failuresText) !== 0) {
    throw new Error("Benchmark has unresolved failures and cannot be packaged");
  }

  const files = await Promise.all(
    includedFiles.map(async (name) => {
      const content = await readFile(join(outputDir, name));
      return {
        path: name,
        bytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }),
  );
  await writeAtomicJson(join(outputDir, "package-manifest.json"), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    question_count: expected,
    files,
  });
  includedFiles.push("package-manifest.json");

  const archiveDirectory = dirname(archivePath);
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const temporaryArchive = `${archivePath}.tmp-${process.pid}-${randomUUID()}`;
  await executeFile("/usr/bin/tar", [
    "-czf",
    temporaryArchive,
    "-C",
    outputDir,
    ...includedFiles,
  ]);
  await chmod(temporaryArchive, 0o600);
  await rename(temporaryArchive, archivePath);
  const archiveStat = await stat(archivePath);
  process.stdout.write(
    `${JSON.stringify({
      command: "package-benchmark",
      questionCount: expected,
      archivePath,
      archiveBytes: archiveStat.size,
    }, null, 2)}\n`,
  );
}

async function prepareLongMemEvalEvaluation(
  parsed: ParsedCommand,
): Promise<void> {
  assertOnlyFlags(parsed, ["source", "predictions", "output"]);
  const sourcePath = resolve(requiredFlag(parsed, "source"));
  const predictionsPath = resolve(requiredFlag(parsed, "predictions"));
  const outputPath = resolve(requiredFlag(parsed, "output"));
  const [sourceSerialized, predictionsSerialized] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(predictionsPath, "utf8"),
  ]);
  const source = JSON.parse(sourceSerialized) as unknown;
  if (!Array.isArray(source)) {
    throw new Error("LongMemEval evaluator source must be an array");
  }
  const sourceByQuestionId = new Map<string, Record<string, unknown>>();
  for (const [index, rawRecord] of source.entries()) {
    if (
      typeof rawRecord !== "object" ||
      rawRecord === null ||
      Array.isArray(rawRecord)
    ) {
      throw new Error(`LongMemEval source record ${index} must be an object`);
    }
    const qa = (rawRecord as Record<string, unknown>).qa;
    if (!Array.isArray(qa) || qa.length !== 1) {
      throw new Error(`LongMemEval source record ${index} must have one QA`);
    }
    const question = qa[0];
    if (
      typeof question !== "object" ||
      question === null ||
      Array.isArray(question)
    ) {
      throw new Error(`LongMemEval source QA ${index} must be an object`);
    }
    const item = question as Record<string, unknown>;
    if (typeof item.question_id !== "string") {
      throw new Error(`LongMemEval source QA ${index} has no question_id`);
    }
    sourceByQuestionId.set(item.question_id, item);
  }

  const evaluatorRecords = predictionsSerialized
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const prediction = JSON.parse(line) as Record<string, unknown>;
      const questionId = prediction.question_id;
      if (
        typeof questionId !== "string" ||
        typeof prediction.response !== "string"
      ) {
        throw new Error(`Prediction line ${index + 1} is invalid`);
      }
      const sourceQuestion = sourceByQuestionId.get(questionId);
      if (!sourceQuestion) {
        throw new Error(`Prediction has unknown question_id: ${questionId}`);
      }
      const answer =
        sourceQuestion.answer_fixed ?? sourceQuestion.answer;
      if (
        typeof sourceQuestion.question !== "string" ||
        typeof sourceQuestion.question_type !== "string" ||
        typeof answer !== "string"
      ) {
        throw new Error(`Evaluator source fields are invalid: ${questionId}`);
      }
      return {
        question_id: questionId,
        abstention: questionId.endsWith("_abs"),
        question_type: sourceQuestion.question_type,
        question: sourceQuestion.question,
        answer,
        response: prediction.response,
        retrieval_status: prediction.retrieval_status,
        citations: prediction.citations,
      };
    });

  const directory = dirname(outputPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(evaluatorRecords, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
  process.stdout.write(
    `${JSON.stringify({
      command: "prepare-longmemeval-eval",
      recordCount: evaluatorRecords.length,
      outputPath,
    }, null, 2)}\n`,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function jsonRecordCount(directory: string): Promise<number> {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") &&
        !entry.name.startsWith("."),
    ).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function runLoggedChild(options: {
  file: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  logPath: string;
  mirrorStderr?: boolean;
}): Promise<number> {
  await mkdir(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const log = createWriteStream(options.logPath, {
    flags: "a",
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(options.logPath, 0o600).catch(() => undefined);
  return new Promise<number>((resolvePromise, reject) => {
    const child = spawn(options.file, options.args, {
      env: options.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => log.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      log.write(chunk);
      if (options.mirrorStderr ?? true) process.stderr.write(chunk);
    });
    child.once("error", (error) => {
      log.end();
      reject(error);
    });
    child.once("close", (code, signal) => {
      log.end(() => {
        if (signal) {
          reject(new Error(`Child process stopped by ${signal}`));
          return;
        }
        resolvePromise(code ?? 1);
      });
    });
  });
}

async function unresolvedFailureMessages(outputDir: string): Promise<string[]> {
  const successes = new Set<string>();
  for (const entry of await readdir(join(outputDir, "records"), {
    withFileTypes: true,
  }).catch(() => [])) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      successes.add(entry.name.slice(0, -5));
    }
  }
  const messages: string[] = [];
  for (const entry of await readdir(join(outputDir, "failure-records"), {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (successes.has(entry.name.slice(0, -5))) continue;
    const failure = await readJsonFileIfPresent<{ error?: unknown }>(
      join(outputDir, "failure-records", entry.name),
    );
    if (typeof failure?.error === "string") messages.push(failure.error);
  }
  return messages;
}

async function auditLongMemEvalSuite(
  outputDir: string,
  expected: number,
): Promise<Record<string, unknown>> {
  const results = JSON.parse(
    await readFile(join(outputDir, "results.json"), "utf8"),
  ) as { result_count?: unknown; results?: BenchmarkSuccessRecord[] };
  if (
    results.result_count !== expected ||
    !Array.isArray(results.results) ||
    results.results.length !== expected
  ) {
    throw new Error("Suite audit found incomplete consolidated results");
  }
  const questionIds = new Set<string>();
  const responseModels = new Map<string, number>();
  const retrievalStatuses = new Map<string, number>();
  let searchedMemories = 0;
  let evidence = 0;
  let citations = 0;
  for (const record of results.results) {
    if (record.schema_version !== 2) {
      throw new Error("Suite audit found an unsupported record schema");
    }
    questionIds.add(record.question_id);
    const retrieval = record.retrieval;
    const candidateIds = new Set(
      retrieval.candidates.map((item) => item.memoryId),
    );
    const evidenceIds = new Set(
      retrieval.evidence.map((item) => item.memoryId),
    );
    const citationIds = new Set(
      retrieval.citations.map((item) => item.memoryId),
    );
    if (
      [...citationIds].some((id) => !evidenceIds.has(id)) ||
      [...evidenceIds].some((id) => !candidateIds.has(id))
    ) {
      throw new Error(`Suite provenance violation: ${record.question_id}`);
    }
    searchedMemories += retrieval.searchedMemories.length;
    evidence += evidenceIds.size;
    citations += citationIds.size;
    retrievalStatuses.set(
      retrieval.status,
      (retrievalStatuses.get(retrieval.status) ?? 0) + 1,
    );
    const responseModel = record.answer.model.responseModel;
    responseModels.set(
      responseModel,
      (responseModels.get(responseModel) ?? 0) + 1,
    );
  }
  if (questionIds.size !== expected) {
    throw new Error("Suite audit found duplicate question IDs");
  }
  const countJsonl = async (name: string): Promise<number> =>
    (await readFile(join(outputDir, name), "utf8"))
      .split("\n")
      .filter(Boolean).length;
  const jsonlCounts = {
    predictions: await countJsonl("predictions.jsonl"),
    traces: await countJsonl("traces.jsonl"),
    failures: await countJsonl("failures.jsonl"),
  };
  if (
    jsonlCounts.predictions !== expected ||
    jsonlCounts.traces !== expected ||
    jsonlCounts.failures !== 0
  ) {
    throw new Error("Suite audit found incomplete JSONL artifacts");
  }
  const audit = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    question_count: expected,
    unique_question_count: questionIds.size,
    provenance_violations: 0,
    jsonl_counts: jsonlCounts,
    retrieval_statuses: Object.fromEntries(retrievalStatuses),
    answer_response_models: Object.fromEntries(responseModels),
    searched_memory_count: searchedMemories,
    evidence_count: evidence,
    citation_count: citations,
  };
  await writeAtomicJson(join(outputDir, "suite-audit.json"), audit);
  return audit;
}

function baselineScores(parsed: ParsedCommand): Array<{
  name: string;
  accuracy: number;
}> {
  return (parsed.flags.get("baseline-score") ?? []).map((raw) => {
    const separator = raw.lastIndexOf("=");
    if (separator <= 0) {
      throw new Error("--baseline-score must use NAME=ACCURACY");
    }
    const name = raw.slice(0, separator).trim();
    const accuracy = Number(raw.slice(separator + 1));
    if (!name || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
      throw new Error("--baseline-score accuracy must be between 0 and 1");
    }
    return { name, accuracy };
  });
}

async function packageEvaluationArtifacts(
  outputDir: string,
  archivePath: string,
): Promise<void> {
  const relativeFiles = [
    "run-manifest.json",
    "suite-audit.json",
    "evaluation/longmemeval-eval.json",
    "evaluation/judge-v5/run-manifest.json",
    "evaluation/judge-v5/results.json",
    "evaluation/judge-v5/summary.json",
    "evaluation/frozen-reanswer/input.json",
    "evaluation/frozen-reanswer/answers/run-manifest.json",
    "evaluation/frozen-reanswer/answers/results.json",
    "evaluation/frozen-reanswer/answers/predictions.jsonl",
    "evaluation/frozen-reanswer/longmemeval-eval.json",
    "evaluation/frozen-reanswer/judge-v5/run-manifest.json",
    "evaluation/frozen-reanswer/judge-v5/results.json",
    "evaluation/frozen-reanswer/judge-v5/summary.json",
    "evaluation/comparison.json",
  ];
  const files = await Promise.all(relativeFiles.map(async (path) => {
    const content = await readFile(join(outputDir, path));
    return {
      path,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }));
  const manifestPath = join(
    outputDir,
    "evaluation/evaluation-package-manifest.json",
  );
  await writeAtomicJson(manifestPath, {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    files,
  });
  relativeFiles.push("evaluation/evaluation-package-manifest.json");
  const destination = resolve(archivePath);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  await executeFile("/usr/bin/tar", [
    "-czf",
    temporary,
    "-C",
    outputDir,
    ...relativeFiles,
  ]);
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
}

async function longMemEvalSuite(parsed: ParsedCommand): Promise<void> {
  assertOnlyFlags(parsed, [
    "source",
    "data-dir",
    "output-dir",
    "retrieval-profile",
    "slots",
    "agent-dir",
    "provider",
    "model",
    "thinking-level",
    "embedding-env",
    "answer-env",
    "judge-env",
    "api-key-env",
    "base-url-env",
    "retry-delay-seconds",
    "archive",
    "judge-script",
    "judge-slots",
    "frozen-slots",
    "judge-variant",
    "evaluation-archive",
    "baseline-score",
  ]);
  const source = resolve(requiredFlag(parsed, "source"));
  const dataDir = resolve(requiredFlag(parsed, "data-dir"));
  const outputDir = resolve(requiredFlag(parsed, "output-dir"));
  const embeddingEnv = resolve(requiredFlag(parsed, "embedding-env"));
  const answerEnv = resolve(requiredFlag(parsed, "answer-env"));
  const judgeEnvPath = resolve(requiredFlag(parsed, "judge-env"));
  const archive = resolve(requiredFlag(parsed, "archive"));
  const evaluationArchive = resolve(
    requiredFlag(parsed, "evaluation-archive"),
  );
  const slots = positiveIntegerFlag(parsed, "slots", 128, 256);
  const judgeSlots = positiveIntegerFlag(parsed, "judge-slots", 32, 256);
  const frozenSlots = positiveIntegerFlag(parsed, "frozen-slots", 32, 256);
  const retryDelaySeconds = positiveNumberFlag(
    parsed,
    "retry-delay-seconds",
    30,
    3_600,
  );
  const retrievalProfile = retrievalProfileFor(parsed);
  const agentDir = resolve(requiredFlag(parsed, "agent-dir"));
  const provider = requiredFlag(parsed, "provider");
  const model = requiredFlag(parsed, "model");
  const thinkingLevel = optionalFlag(parsed, "thinking-level") ?? "off";
  const apiKeyEnv = optionalFlag(parsed, "api-key-env") ?? "OPENAI_API_KEY";
  const baseUrlEnv = optionalFlag(parsed, "base-url-env") ?? "OPENAI_API_BASE";
  const judgeScript = resolve(
    optionalFlag(parsed, "judge-script") ??
      "scripts/longmemeval_frozen_eval.py",
  );
  const judgeVariant = optionalFlag(parsed, "judge-variant") ??
    `${PIMEM_HARNESS_VERSION}-full`;
  const configuredBaselines = baselineScores(parsed);
  const questions = await readPrivateQuestions(
    dataPaths(dataDir).privateQuestions,
  );
  const expected = questions.length;
  if (expected === 0) throw new Error("Suite has no private benchmark questions");

  const benchmarkEnvironment = await loadProtectedEnvironment([
    embeddingEnv,
    answerEnv,
  ]);
  requireEnvironmentVariable(benchmarkEnvironment, apiKeyEnv);
  requireEnvironmentVariable(benchmarkEnvironment, baseUrlEnv);
  const judgeEnvironment = await loadProtectedEnvironment(
    [judgeEnvPath],
    benchmarkEnvironment,
  );

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const statusPath = join(outputDir, "suite-status");
  const suiteLog = join(outputDir, "suite.log");
  const waveLog = join(outputDir, "suite-waves.jsonl");
  await writeAtomicText(statusPath, "running\n");
  await appendFile(suiteLog, "", { mode: 0o600 });
  await appendFile(waveLog, "", { mode: 0o600 });
  await Promise.all([chmod(suiteLog, 0o600), chmod(waveLog, 0o600)]);

  const progressScript = resolve("scripts/benchmark_progress.py");
  let progress: ChildProcess | undefined;
  try {
    progress = spawn("python3", [
      progressScript,
      "--records-dir", join(outputDir, "records"),
      "--failures-dir", join(outputDir, "failure-records"),
      "--status-file", statusPath,
      "--progress-file", join(outputDir, "benchmark-progress.json"),
      "--total", String(expected),
    ], {
      env: benchmarkEnvironment,
      stdio: ["ignore", "ignore", "inherit"],
    });

    let wave = 0;
    while (await jsonRecordCount(join(outputDir, "records")) < expected) {
      wave += 1;
      const before = await jsonRecordCount(join(outputDir, "records"));
      await appendFile(waveLog, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "start",
        wave,
        completed: before,
      })}\n`, { mode: 0o600 });
      await writeAtomicText(statusPath, "running\n");
      const childArgs = [
        resolve(process.argv[1]!),
        "benchmark-longmemeval",
        "--data-dir", dataDir,
        "--output-dir", outputDir,
        "--retrieval-profile", retrievalProfile,
        "--slots", String(slots),
        "--agent-dir", agentDir,
        "--provider", provider,
        "--model", model,
        "--thinking-level", thinkingLevel,
        "--api-key-env", apiKeyEnv,
        "--base-url-env", baseUrlEnv,
      ];
      const code = await runLoggedChild({
        file: process.execPath,
        args: childArgs,
        environment: benchmarkEnvironment,
        logPath: suiteLog,
      });
      const after = await jsonRecordCount(join(outputDir, "records"));
      await appendFile(waveLog, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "finish",
        wave,
        exitCode: code,
        completed: after,
      })}\n`, { mode: 0o600 });
      if (after >= expected) break;
      const messages = await unresolvedFailureMessages(outputDir);
      if (messages.some((message) =>
        /(?:\b401\b|\b403\b|invalid token|unauthori[sz]ed)/iu.test(message)
      )) {
        throw new Error(
          "Suite stopped after a credential/provider mismatch; update the protected answer environment before resuming",
        );
      }
      await writeAtomicText(statusPath, "retrying\n");
      await sleep(retryDelaySeconds * 1_000);
    }

    await writeAtomicText(statusPath, "auditing\n");
    await auditLongMemEvalSuite(outputDir, expected);
    await writeAtomicText(statusPath, "packaging-benchmark\n");
    const packageCode = await runLoggedChild({
      file: process.execPath,
      args: [
        resolve(process.argv[1]!),
        "package-benchmark",
        "--output-dir", outputDir,
        "--archive", archive,
      ],
      environment: benchmarkEnvironment,
      logPath: suiteLog,
    });
    if (packageCode !== 0) throw new Error("Benchmark packaging failed");

    const evaluationDir = join(outputDir, "evaluation");
    const judgeDir = join(evaluationDir, "judge-v5");
    await mkdir(judgeDir, { recursive: true, mode: 0o700 });
    await chmod(judgeDir, 0o700);
    await writeAtomicText(statusPath, "preparing-evaluation\n");
    const prepareCode = await runLoggedChild({
      file: process.execPath,
      args: [
        resolve(process.argv[1]!),
        "prepare-longmemeval-eval",
        "--source", source,
        "--predictions", join(outputDir, "predictions.jsonl"),
        "--output", join(evaluationDir, "longmemeval-eval.json"),
      ],
      environment: benchmarkEnvironment,
      logPath: suiteLog,
    });
    if (prepareCode !== 0) throw new Error("Evaluation preparation failed");

    await writeAtomicText(statusPath, "judging\n");
    const judgeCode = await runLoggedChild({
      file: "python3",
      args: [
        judgeScript,
        "judge",
        "--input", join(evaluationDir, "longmemeval-eval.json"),
        "--output-dir", judgeDir,
        "--slots", String(judgeSlots),
        "--variant", judgeVariant,
      ],
      environment: judgeEnvironment,
      logPath: suiteLog,
    });
    if (judgeCode !== 0) throw new Error("Judger v5 failed");

    const judgeSummary = JSON.parse(
      await readFile(join(judgeDir, "summary.json"), "utf8"),
    ) as {
      judge_model?: unknown;
      prompt_hash?: unknown;
      metrics?: { overall?: { correct?: unknown; total?: unknown; accuracy?: unknown } };
    };
    const overall = judgeSummary.metrics?.overall;
    if (
      typeof overall?.correct !== "number" ||
      overall.total !== expected ||
      typeof overall.accuracy !== "number"
    ) {
      throw new Error("Judger summary is incomplete");
    }
    const frozenDir = join(evaluationDir, "frozen-reanswer");
    const frozenAnswerDir = join(frozenDir, "answers");
    const frozenJudgeDir = join(frozenDir, "judge-v5");
    const frozenVariant = `${judgeVariant}-frozen-searched-memories`;
    await mkdir(frozenJudgeDir, { recursive: true, mode: 0o700 });
    await writeAtomicText(statusPath, "preparing-frozen-reanswer\n");
    const frozenPrepareCode = await runLoggedChild({
      file: "python3",
      args: [
        judgeScript,
        "prepare-frozen-input",
        "--results", join(outputDir, "results.json"),
        "--output", join(frozenDir, "input.json"),
      ],
      environment: benchmarkEnvironment,
      logPath: suiteLog,
    });
    if (frozenPrepareCode !== 0) {
      throw new Error("Frozen re-answer input preparation failed");
    }
    await writeAtomicText(statusPath, "frozen-reanswer\n");
    const frozenAnswerCode = await runLoggedChild({
      file: "python3",
      args: [
        judgeScript,
        "reanswer",
        "--input", join(frozenDir, "input.json"),
        "--output-dir", frozenAnswerDir,
        "--slots", String(frozenSlots),
      ],
      environment: benchmarkEnvironment,
      logPath: suiteLog,
    });
    if (frozenAnswerCode !== 0) throw new Error("Frozen re-answer failed");

    const frozenPrepareEvalCode = await runLoggedChild({
      file: process.execPath,
      args: [
        resolve(process.argv[1]!),
        "prepare-longmemeval-eval",
        "--source", source,
        "--predictions", join(frozenAnswerDir, "predictions.jsonl"),
        "--output", join(frozenDir, "longmemeval-eval.json"),
      ],
      environment: benchmarkEnvironment,
      logPath: suiteLog,
    });
    if (frozenPrepareEvalCode !== 0) {
      throw new Error("Frozen evaluator preparation failed");
    }
    await writeAtomicText(statusPath, "judging-frozen-reanswer\n");
    const frozenJudgeCode = await runLoggedChild({
      file: "python3",
      args: [
        judgeScript,
        "judge",
        "--input", join(frozenDir, "longmemeval-eval.json"),
        "--output-dir", frozenJudgeDir,
        "--slots", String(judgeSlots),
        "--variant", frozenVariant,
      ],
      environment: judgeEnvironment,
      logPath: suiteLog,
    });
    if (frozenJudgeCode !== 0) throw new Error("Frozen Judger v5 failed");

    const frozenSummary = JSON.parse(
      await readFile(join(frozenJudgeDir, "summary.json"), "utf8"),
    ) as {
      judge_model?: unknown;
      prompt_hash?: unknown;
      metrics?: { overall?: { correct?: unknown; total?: unknown; accuracy?: unknown } };
    };
    const frozenOverall = frozenSummary.metrics?.overall;
    if (
      typeof frozenOverall?.correct !== "number" ||
      frozenOverall.total !== expected ||
      typeof frozenOverall.accuracy !== "number"
    ) {
      throw new Error("Frozen judge summary is incomplete");
    }
    const currentJudgeResults = JSON.parse(
      await readFile(join(judgeDir, "results.json"), "utf8"),
    ) as { results?: Array<{ question_id?: unknown; label?: unknown }> };
    const frozenJudgeResults = JSON.parse(
      await readFile(join(frozenJudgeDir, "results.json"), "utf8"),
    ) as { results?: Array<{ question_id?: unknown; label?: unknown }> };
    if (
      !Array.isArray(currentJudgeResults.results) ||
      !Array.isArray(frozenJudgeResults.results)
    ) {
      throw new Error("Paired judge results are missing");
    }
    const currentLabels = new Map(
      currentJudgeResults.results.map((item) => [item.question_id, item.label]),
    );
    const transitions = {
      both_correct: 0,
      end_to_end_wrong_to_frozen_correct: 0,
      end_to_end_correct_to_frozen_wrong: 0,
      both_wrong: 0,
    };
    for (const item of frozenJudgeResults.results) {
      const currentCorrect = currentLabels.get(item.question_id) === "CORRECT";
      const frozenCorrect = item.label === "CORRECT";
      if (currentCorrect && frozenCorrect) transitions.both_correct += 1;
      else if (!currentCorrect && frozenCorrect) {
        transitions.end_to_end_wrong_to_frozen_correct += 1;
      } else if (currentCorrect && !frozenCorrect) {
        transitions.end_to_end_correct_to_frozen_wrong += 1;
      } else transitions.both_wrong += 1;
    }
    if (Object.values(transitions).reduce((sum, value) => sum + value, 0) !== expected) {
      throw new Error("Paired comparison is incomplete");
    }

    const currentAccuracy = overall.accuracy;
    const frozenAccuracy = frozenOverall.accuracy;
    const frozenDelta = frozenAccuracy - currentAccuracy;
    const comparison = {
      schema_version: 2,
      generated_at: new Date().toISOString(),
      current: {
        variant: judgeVariant,
        correct: overall.correct,
        total: overall.total,
        accuracy: currentAccuracy,
        judge_model: judgeSummary.judge_model,
        judge_prompt_hash: judgeSummary.prompt_hash,
      },
      frozen_current_retrieval: {
        variant: frozenVariant,
        correct: frozenOverall.correct,
        total: frozenOverall.total,
        accuracy: frozenAccuracy,
        delta_accuracy: Number(frozenDelta.toFixed(6)),
        delta_percentage_points: Number((frozenDelta * 100).toFixed(4)),
        judge_model: frozenSummary.judge_model,
        judge_prompt_hash: frozenSummary.prompt_hash,
      },
      paired_transitions: transitions,
      baselines: configuredBaselines.map((baseline) => {
        const delta = currentAccuracy - baseline.accuracy;
        return {
          ...baseline,
          delta_accuracy: Number(delta.toFixed(6)),
          delta_percentage_points: Number((delta * 100).toFixed(4)),
        };
      }),
    };
    await writeAtomicJson(join(evaluationDir, "comparison.json"), comparison);
    await writeAtomicText(statusPath, "packaging-evaluation\n");
    await packageEvaluationArtifacts(outputDir, evaluationArchive);
    await writeAtomicText(statusPath, "complete\n");
    process.stdout.write(`${JSON.stringify({
      command: "longmemeval-suite",
      status: "complete",
      questionCount: expected,
      auditPath: join(outputDir, "suite-audit.json"),
      benchmarkArchive: archive,
      judgeSummary: join(judgeDir, "summary.json"),
      comparisonPath: join(evaluationDir, "comparison.json"),
      evaluationArchive,
    }, null, 2)}\n`);
  } catch (error) {
    await writeAtomicText(statusPath, "failed\n");
    throw error;
  } finally {
    if (progress && progress.exitCode === null) progress.kill("SIGTERM");
  }
}

function printHelp(): void {
  process.stdout.write(`PiMem — minimal source-grounded memory agent

Commands:
  ingest-longmemeval --source FILE --data-dir DIR [--question-id ID ...] [--retrieval-profile fts5|pimem-hybrid] [--embedding-slots N] [--embedding-rps N]
  run-longmemeval    --data-dir DIR --question-id ID [--retrieval-profile fts5|pimem-hybrid] [--model ID]
  benchmark-longmemeval --data-dir DIR --output-dir DIR [--question-id ID ...] [--retrieval-profile fts5|pimem-hybrid] [--model ID] [--slots N]
  longmemeval-suite --source FILE --data-dir DIR --output-dir DIR --embedding-env FILE --answer-env FILE --judge-env FILE --agent-dir DIR --provider ID --model ID --archive FILE.tar.gz --evaluation-archive FILE.tar.gz [--slots N] [--frozen-slots N] [--judge-slots N]
  prepare-longmemeval-eval --source FILE --predictions FILE --output FILE
  package-benchmark   --output-dir DIR --archive FILE.tar.gz
  run                 --data-dir DIR --scope ID --question TEXT [--question-date TEXT] [--retrieval-profile fts5|pimem-hybrid] [--model ID]
`);
}

async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));
  switch (parsed.command) {
    case "ingest-longmemeval":
      await ingestLongMemEval(parsed);
      return;
    case "run-longmemeval":
      await runLongMemEval(parsed);
      return;
    case "benchmark-longmemeval":
      await benchmarkLongMemEval(parsed);
      return;
    case "longmemeval-suite":
      await longMemEvalSuite(parsed);
      return;
    case "prepare-longmemeval-eval":
      await prepareLongMemEvalEvaluation(parsed);
      return;
    case "package-benchmark":
      await packageBenchmark(parsed);
      return;
    case "run":
      await runGeneric(parsed);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`PiMem error: ${message}\n`);
  process.exitCode = 1;
});
