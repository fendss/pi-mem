#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const RAW_PROMPT_VERSION = "scriptmem-answer-raw-top30-v1";
const PRODUCTS_PROMPT_VERSION = "scriptmem-answer-raw-top30-plus-agent-text-v1";
const PROMPT_TEMPLATE = `You answer a ScriptMem question using only the retrieved raw conversation memories.

<instructions>
1. Treat the retrieved raw memories as the only evidence. Do not use outside knowledge of the script or its characters.
2. For a single-choice question, output only one option label in parentheses, for example (C).
3. For a multi-select question, output only the selected option labels in the requested order, for example (A), (D).
4. For an ordering question, output only the option labels in the requested order.
5. Do not explain your reasoning or repeat the question. If the retrieved evidence is insufficient, answer (UNKNOWN).
</instructions>

<retrieved_raw_memories>
{{memories}}
</retrieved_raw_memories>
{{agent_products_block}}
Question: {{question}}
Answer:`;

const AGENT_PRODUCTS_TEMPLATE = `<agent_products>
Pi-Mem also produced the following natural-language synthesis from the retrieved memories. Use it as a reading aid, but verify it against the original conversation memories above.

Pi-Mem evidence summary:
{{evidence_summary}}

Pi-Mem supporting notes:
{{supports}}
</agent_products>
`;

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const sourceRoot = requiredEnv("PI_MEM_SOURCE_ROOT");
const retrievalRecordsRoot = requiredEnv("RETRIEVAL_RECORDS_ROOT");
const privateQuestionsPath = requiredEnv("PRIVATE_QUESTIONS_PATH");
const outputRoot = requiredEnv("OUTPUT_ROOT");
const providerId = process.env.PROVIDER_ID?.trim() || "zgy-openai";
const modelId = process.env.MODEL_ID?.trim() || "gpt-5.4-mini";
const thinkingLevel = process.env.THINKING_LEVEL?.trim() || "off";
const slots = Number(process.env.SLOTS ?? "16");
const topK = Number(process.env.TOP_K ?? "30");
const maxRunMs = Number(process.env.MAX_RUN_MS ?? "600000");
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? "4");
const includeAgentProducts = process.env.INCLUDE_AGENT_PRODUCTS === "true";
const promptVersion = includeAgentProducts ? PRODUCTS_PROMPT_VERSION : RAW_PROMPT_VERSION;
if (!Number.isSafeInteger(slots) || slots < 1 || slots > 128) {
  throw new Error("SLOTS must be an integer between 1 and 128");
}
if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) {
  throw new Error("TOP_K must be an integer between 1 and 100");
}

const { runBenchmarkAnswer } = await import(
  pathToFileURL(path.join(sourceRoot, "dist", "benchmark-answer.js")).href
);
const { loadPiModelRuntime } = await import(
  pathToFileURL(path.join(sourceRoot, "dist", "model.js")).href
);

const recordsDir = path.join(outputRoot, "records");
const failuresDir = path.join(outputRoot, "failures");
const readJsonLines = (file) => fs.readFileSync(file, "utf8")
  .split("\n").filter(Boolean).map(JSON.parse);
const sha256Buffer = (value) => createHash("sha256").update(value).digest("hex");
const sha256File = (file) => sha256Buffer(fs.readFileSync(file));
const sha256Json = (value) => sha256Buffer(JSON.stringify(value));
const safeSegment = (value) => value.replace(/[^A-Za-z0-9._-]/gu, "_");

async function writeAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await fsp.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporary, file);
}
const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

function renderAgentProducts(products) {
  const supports = products.supports.length
    ? products.supports.map((support) => `- ${support}`).join("\n")
    : "- No supporting notes were produced.";
  return AGENT_PRODUCTS_TEMPLATE
    .replace("{{evidence_summary}}", products.evidenceSummary)
    .replace("{{supports}}", supports);
}

function renderMemory(memory) {
  const metadata = memory.metadata ?? {};
  const session = metadata.session ?? {};
  const turn = metadata.turn ?? {};
  const sessionName = session.sourceSessionId ?? "unknown session";
  const turnName = turn.sourceDiaId ?? String(memory.turnIndex ?? "unknown turn");
  const speaker = turn.sourceSpeaker ?? memory.role ?? "unknown speaker";
  return `Conversation excerpt from ${sessionName}, ${turnName}, speaker ${speaker}:\n${memory.content}`;
}

const questions = readJsonLines(privateQuestionsPath);
const order = new Map(questions.map((item, index) => [item.questionId, index]));
const sourceRecords = fs.readdirSync(retrievalRecordsRoot)
  .filter((name) => name.endsWith(".json"))
  .map((name) => {
    const file = path.join(retrievalRecordsRoot, name);
    return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  })
  .sort((left, right) => order.get(left.value.question_id) - order.get(right.value.question_id));
if (
  questions.length !== 457 || sourceRecords.length !== 457 ||
  new Set(sourceRecords.map((item) => item.value.question_id)).size !== 457
) {
  throw new Error(`Expected 457 unique ScriptMem questions, got ${sourceRecords.length}`);
}

const jobs = sourceRecords.map(({ file, value }) => {
  const artifactPath = value.source_agent_artifact?.path;
  const expectedArtifactHash = value.source_agent_artifact?.sha256;
  if (!artifactPath || sha256File(artifactPath) !== expectedArtifactHash) {
    throw new Error(`Agent artifact hash mismatch for ${value.question_id}`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (artifact.status !== "ok" || artifact.agent?.run_id !== value.retrieval.runId) {
    throw new Error(`Agent artifact identity mismatch for ${value.question_id}`);
  }
  const searched = artifact.agent?.memory?.searched_memories;
  if (!Array.isArray(searched) || searched.length === 0) {
    throw new Error(`No searched raw memories for ${value.question_id}`);
  }
  const seen = new Set();
  const deduplicated = searched.filter((memory) => {
    if (!memory.memoryId || typeof memory.content !== "string") {
      throw new Error(`Invalid raw memory for ${value.question_id}`);
    }
    if (seen.has(memory.memoryId)) return false;
    seen.add(memory.memoryId);
    return true;
  });
  const selected = deduplicated.slice(0, topK);
  const evidenceSummary = value.retrieval.evidenceSummary;
  if (typeof evidenceSummary !== "string" || !evidenceSummary.trim()) {
    throw new Error(`Missing Agent evidence summary for ${value.question_id}`);
  }
  const supports = (value.retrieval.citations ?? [])
    .map((citation) => citation.supports?.trim())
    .filter(Boolean);
  const agentProducts = { evidenceSummary: evidenceSummary.trim(), supports };
  const prompt = {
    adapterId: includeAgentProducts
      ? "scriptmem-v19-raw-top30-plus-agent-text"
      : "scriptmem-v19-raw-top30",
    promptVersion,
    systemPrompt: "",
    userPrompt: PROMPT_TEMPLATE
      .replace("{{memories}}", selected.map(renderMemory).join("\n\n"))
      .replace(
        "{{agent_products_block}}",
        includeAgentProducts ? `\n${renderAgentProducts(agentProducts)}\n` : "\n",
      )
      .replace("{{question}}", value.retrieval.question),
  };
  return {
    questionId: value.question_id,
    script: value.script,
    sourceStatus: value.retrieval.status,
    selected,
    agentProducts,
    searchedCount: deduplicated.length,
    prompt,
    sourceRecord: file,
    sourceRecordSha256: sha256File(file),
    sourceArtifact: artifactPath,
    sourceArtifactSha256: expectedArtifactHash,
  };
});

await fsp.mkdir(recordsDir, { recursive: true, mode: 0o700 });
await fsp.mkdir(failuresDir, { recursive: true, mode: 0o700 });
const promptLengths = jobs.map((job) => job.prompt.userPrompt.length);
await writeJson(path.join(outputRoot, "run-manifest.json"), {
  schema_version: includeAgentProducts
    ? "pimem-scriptmem-raw-top30-plus-agent-text-answer/v1"
    : "pimem-scriptmem-raw-top30-answer/v1",
  created_at: new Date().toISOString(),
  question_count: jobs.length,
  retrieval_source: retrievalRecordsRoot,
  answer: {
    provider: providerId,
    model: modelId,
    thinking_level: thinkingLevel,
    prompt_version: promptVersion,
    prompt_template_sha256: sha256Buffer(
      includeAgentProducts ? `${PROMPT_TEMPLATE}\n${AGENT_PRODUCTS_TEMPLATE}` : PROMPT_TEMPLATE,
    ),
    top_k: topK,
    raw_memory_fields_in_prompt: ["source session", "source turn", "source speaker", "immutable content"],
    agent_products_included: includeAgentProducts,
    included_agent_product_fields: includeAgentProducts ? ["evidenceSummary", "citation supports"] : [],
    excluded_from_prompt: includeAgentProducts
      ? ["selection status", "memory IDs", "count", "inventory", "queries", "ranks", "candidate metadata", "reasoning trace"]
      : ["selection status", "evidence summary", "citations", "citation supports", "count", "inventory", "candidate metadata", "reasoning trace"],
    slots,
    max_run_ms: maxRunMs,
    max_attempts: maxAttempts,
  },
  memory_count: {
    min: Math.min(...jobs.map((job) => job.selected.length)),
    max: Math.max(...jobs.map((job) => job.selected.length)),
    mean: jobs.reduce((sum, job) => sum + job.selected.length, 0) / jobs.length,
  },
  prompt_chars: {
    min: Math.min(...promptLengths),
    max: Math.max(...promptLengths),
    mean: promptLengths.reduce((sum, value) => sum + value, 0) / promptLengths.length,
  },
});

const modelRuntime = await loadPiModelRuntime({ providerId, modelId, thinkingLevel });
let cursor = 0;
let completedThisRun = 0;
let skipped = 0;
let failed = 0;

async function runJob(job, worker) {
  const recordPath = path.join(recordsDir, `${safeSegment(job.questionId)}.json`);
  try {
    const existing = JSON.parse(await fsp.readFile(recordPath, "utf8"));
    if (
      existing?.answer?.answer && existing?.question_id === job.questionId &&
      existing?.answer_input?.raw_memory_hash === sha256Json(job.selected) &&
      (
        includeAgentProducts
          ? existing?.answer_input?.agent_products_hash === sha256Json(job.agentProducts)
          : existing?.answer_input?.agent_products_included === false
      )
    ) {
      skipped += 1;
      return;
    }
    throw new Error(`Existing record contract mismatch for ${job.questionId}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const answer = await runBenchmarkAnswer({
        modelRuntime,
        prompt: job.prompt,
        maxRunMs,
      });
      const prediction = {
        question_id: job.questionId,
        response: answer.answer,
        citations: [],
        retrieval_status: job.sourceStatus,
        answer_model: answer.model,
        answer_prompt: {
          adapter: answer.promptAdapter,
          version: answer.promptVersion,
          hash: answer.promptHash,
        },
      };
      await writeJson(recordPath, {
        schema_version: "pimem-scriptmem-raw-top30-answer-record/v1",
        question_id: job.questionId,
        script: job.script,
        source_retrieval_record: { path: job.sourceRecord, sha256: job.sourceRecordSha256 },
        source_agent_artifact: { path: job.sourceArtifact, sha256: job.sourceArtifactSha256 },
        answer_input: {
          raw_memory_count: job.selected.length,
          raw_memory_hash: sha256Json(job.selected),
          raw_memories: job.selected,
          agent_products_included: includeAgentProducts,
          agent_product_fields: includeAgentProducts ? ["evidenceSummary", "citation supports"] : [],
          agent_products_hash: includeAgentProducts ? sha256Json(job.agentProducts) : null,
          agent_products: includeAgentProducts ? job.agentProducts : null,
          gold_fields_present: false,
        },
        answer,
        prediction,
        timing: { answer_duration_ms: Date.now() - startedAt, attempt, worker },
      });
      await fsp.rm(path.join(failuresDir, `${safeSegment(job.questionId)}.json`), { force: true });
      completedThisRun += 1;
      process.stdout.write(`${JSON.stringify({ event: "answer_ok", question_id: job.questionId, worker, attempt, completed_this_run: completedThisRun })}\n`);
      return;
    } catch (error) {
      lastError = error;
      const errorText = error instanceof Error ? error.message : String(error);
      const nonRetryable = /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid.{0,20}(?:token|api.?key)|response model|model substitution|expected model)/iu.test(errorText);
      process.stdout.write(`${JSON.stringify({ event: nonRetryable ? "answer_rejected" : "answer_retry", question_id: job.questionId, worker, attempt, error: errorText })}\n`);
      if (nonRetryable) break;
      if (attempt < maxAttempts) {
        const delay = Math.min(30_000, 1_500 * (2 ** (attempt - 1)));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  failed += 1;
  await writeJson(path.join(failuresDir, `${safeSegment(job.questionId)}.json`), {
    question_id: job.questionId,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    max_attempts: maxAttempts,
  });
}

async function worker(workerId) {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= jobs.length) return;
    await runJob(jobs[index], workerId);
  }
}

await Promise.all(Array.from({ length: slots }, (_, index) => worker(index + 1)));
const records = [];
for (const job of jobs) {
  const recordPath = path.join(recordsDir, `${safeSegment(job.questionId)}.json`);
  try {
    records.push(JSON.parse(await fsp.readFile(recordPath, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
records.sort((left, right) => order.get(left.question_id) - order.get(right.question_id));
await writeAtomic(
  path.join(outputRoot, "predictions.jsonl"),
  records.map((record) => JSON.stringify(record.prediction)).join("\n") + (records.length ? "\n" : ""),
);
await writeJson(path.join(outputRoot, "answer-summary.json"), {
  schema_version: 1,
  question_count: jobs.length,
  completed: records.length,
  completed_this_run: completedThisRun,
  skipped,
  failed,
  complete: records.length === jobs.length && failed === 0,
  updated_at: new Date().toISOString(),
});
if (records.length !== jobs.length || failed !== 0) {
  throw new Error(`Answer stage incomplete: ${records.length}/${jobs.length}, failures=${failed}`);
}
