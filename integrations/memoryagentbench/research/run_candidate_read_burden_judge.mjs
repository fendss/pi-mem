#!/usr/bin/env node

/** Fresh paired GPT-4o judging using the frozen official LongMemEval prompt. */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain an object`);
  }
  return value;
}

function writeJsonDurable(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  const descriptor = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    values[flag.slice(2)] = value;
  }
  for (const name of ["experiment", "runtime-source", "config"]) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const concurrency = Number(values.concurrency ?? "8");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("--concurrency must be in [1, 32]");
  }
  return {
    experiment: resolve(values.experiment),
    runtimeSource: resolve(values["runtime-source"]),
    config: resolve(values.config),
    concurrency,
  };
}

async function runPool(units, concurrency, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= units.length) return;
      await operation(units[index]);
    }
  });
  await Promise.all(workers);
}

function exactMcNemar(aOnly, bOnly) {
  const discordant = aOnly + bOnly;
  if (discordant === 0) return 1;
  const limit = Math.min(aOnly, bOnly);
  let term = 1;
  let sum = 1;
  for (let index = 1; index <= limit; index += 1) {
    term *= (discordant - index + 1) / index;
    sum += term;
  }
  return Math.min(1, 2 * sum / (2 ** discordant));
}

function pairedSummary(rows) {
  const byId = new Map();
  for (const row of rows) {
    const pair = byId.get(row.benchmark_query_id) ?? {};
    pair[row.arm] = row.label;
    byId.set(row.benchmark_query_id, pair);
  }
  let both = 0;
  let aOnly = 0;
  let bOnly = 0;
  let neither = 0;
  for (const pair of byId.values()) {
    if (typeof pair.a_current_exact_read !== "boolean" ||
      typeof pair.b_current_plus_top4_unread_parent !== "boolean") {
      throw new Error("paired judge labels are incomplete");
    }
    if (pair.a_current_exact_read && pair.b_current_plus_top4_unread_parent) both += 1;
    else if (pair.a_current_exact_read) aOnly += 1;
    else if (pair.b_current_plus_top4_unread_parent) bOnly += 1;
    else neither += 1;
  }
  const count = byId.size;
  const aCorrect = both + aOnly;
  const bCorrect = both + bOnly;
  return {
    count,
    a_current_exact_read: { correct: aCorrect, accuracy: aCorrect / count },
    b_current_plus_top4_unread_parent: { correct: bCorrect, accuracy: bCorrect / count },
    delta_b_minus_a: (bCorrect - aCorrect) / count,
    paired_flips: { both_correct: both, a_only: aOnly, b_only: bOnly, neither },
    mcnemar_exact_two_sided_p: exactMcNemar(aOnly, bOnly),
  };
}

function sumUsage(rows) {
  const totals = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.usage ?? {})) {
      if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

const args = parseArgs(process.argv.slice(2));
const experiment = args.experiment;
const runManifestPath = join(experiment, "RUN_MANIFEST.json");
const runManifest = readJson(runManifestPath);
if (runManifest.status !== "answers_complete_judge_pending") {
  throw new Error("Answers are not complete and judge-ready");
}
const answerPath = resolve(runManifest.answer_results);
const judgeInputPath = resolve(runManifest.judge_input);
if (sha256(readFileSync(answerPath)) !== runManifest.answer_results_sha256 ||
  sha256(readFileSync(judgeInputPath)) !== runManifest.judge_input_sha256) {
  throw new Error("Answer or judge input hash changed");
}
const answers = readJson(answerPath);
const input = readJson(judgeInputPath);
if (input.rows.length !== 196 || answers.rows.length !== 196 ||
  answers.attempt_audit?.all_successful_output_attempts_equal_one !== true) {
  throw new Error("Successful answer attempt semantics are incomplete");
}
if (sha256(readFileSync(args.config)) !== answers.config_sha256) {
  throw new Error("Secure provider config changed between answer and judge");
}

const officialModulePath = join(
  args.runtimeSource,
  "integrations/memoryagentbench/evaluate_longmemeval_official.mjs",
);
const configModulePath = join(
  args.runtimeSource,
  "integrations/memoryagentbench/run_from_yaml.mjs",
);
const official = await import(pathToFileURL(officialModulePath).href);
const { loadMemoryAgentBenchYaml } = await import(pathToFileURL(configModulePath).href);
const config = loadMemoryAgentBenchYaml(args.config);
const generation = config.credentials.generation;
const judgeContract = input.judge_contract;
if (judgeContract.model !== "gpt-4o" ||
  judgeContract.official_prompt_sha256 !==
    "2c90b57efc5142071e32e10b3b131bbad6ee37626b6287d007ab1f52a2cdf54d") {
  throw new Error("Official GPT-4o judge contract changed");
}

const preparedUnits = input.rows.map((row) => {
  const prompt = official.officialLongMemEvalPrompt(
    row.question_type,
    official.originalLongMemEvalQuestion(row.query),
    official.officialAnswerText(row.answer),
    row.output,
    String(row.question_id).includes("_abs"),
  );
  return { ...row, prompt, promptSha256: sha256(prompt) };
});
const outputPath = join(experiment, "evaluation/gpt4o-official/paired-results.json");
let output;
if (existsSync(outputPath)) {
  output = readJson(outputPath);
  if (output.preparation_sha256 !== input.preparation_sha256 ||
    output.answer_results_sha256 !== input.answer_results_sha256 ||
    output.judge_input_sha256 !== runManifest.judge_input_sha256) {
    throw new Error("Judge checkpoint belongs to another paired answer set");
  }
} else {
  output = {
    schema_version: 1,
    status: "judge_in_progress",
    experiment: input.experiment,
    preparation_sha256: input.preparation_sha256,
    answer_results_sha256: input.answer_results_sha256,
    judge_input_sha256: runManifest.judge_input_sha256,
    judge_contract: judgeContract,
    sampling_semantics: {
      successful_output_attempts: 1,
      successful_output_discarded: false,
      provider_infrastructure_recovery: "unbounded exact-request retry in frozen official judge",
      infrastructure_attempts_recorded_separately: true,
    },
    scheduler: {
      concurrency: args.concurrency,
      order: "same pre-registered paired schedule as answers",
      durability: "atomic replace + file fsync + directory fsync after every successful unit",
    },
    rows: [],
  };
  writeJsonDurable(outputPath, output);
}
const completed = new Map(
  output.rows.map((row) => [`${row.benchmark_query_id}\0${row.arm}`, row]),
);
if (completed.size !== output.rows.length) throw new Error("Duplicate judge checkpoint units");
for (const unit of preparedUnits) {
  const prior = completed.get(`${unit.benchmark_query_id}\0${unit.arm}`);
  if (prior !== undefined && (
    prior.source_prediction_sha256 !== unit.source_prediction_sha256 ||
    prior.judge_prompt_sha256 !== unit.promptSha256 ||
    prior.attempts !== 1 || typeof prior.label !== "boolean"
  )) {
    throw new Error("Judge checkpoint row identity or attempt semantics changed");
  }
}
const pending = preparedUnits.filter((unit) =>
  !completed.has(`${unit.benchmark_query_id}\0${unit.arm}`)
);
await runPool(pending, args.concurrency, async (unit) => {
  const result = await official.judge({
    baseUrl: generation.baseUrl,
    apiKey: generation.apiKey,
    model: judgeContract.model,
    prompt: unit.prompt,
  });
  const row = {
    schedule_index: unit.schedule_index,
    pair_index: unit.pair_index,
    benchmark_query_id: unit.benchmark_query_id,
    arm: unit.arm,
    group: unit.group,
    current_judge_correct: unit.current_judge_correct,
    question_id: unit.question_id,
    question_type: unit.question_type,
    source_prediction: unit.output,
    source_prediction_sha256: unit.source_prediction_sha256,
    judge_prompt_sha256: unit.promptSha256,
    label: result.label,
    judge_response: result.response,
    response_model: result.responseModel,
    attempts: 1,
    infrastructure_attempts: result.attempts,
  };
  completed.set(`${unit.benchmark_query_id}\0${unit.arm}`, row);
  output.rows = [...completed.values()].sort((left, right) =>
    left.schedule_index - right.schedule_index
  );
  output.completed_units = output.rows.length;
  writeJsonDurable(outputPath, output);
  if (output.rows.length % 10 === 0 || output.rows.length === 196) {
    process.stdout.write(`${JSON.stringify({ completed: output.rows.length, total: 196 })}\n`);
  }
});
if (completed.size !== 196) throw new Error("Fresh paired judge set is incomplete");
output.rows = [...completed.values()].sort((left, right) =>
  left.schedule_index - right.schedule_index
);
if (output.rows.some((row) => row.attempts !== 1)) {
  throw new Error("A successful judge output was resampled");
}
output.status = "complete";
output.attempt_audit = {
  successful_outputs: 196,
  all_successful_output_attempts_equal_one: true,
  total_infrastructure_attempts: output.rows.reduce(
    (total, row) => total + row.infrastructure_attempts, 0
  ),
  units_with_infrastructure_recovery: output.rows.filter(
    (row) => row.infrastructure_attempts > 1
  ).length,
  successful_output_discarded: false,
};
writeJsonDurable(outputPath, output);

const candidateRows = output.rows.filter(
  (row) => row.group === "candidate_all_not_read_stage"
);
const guardRows = output.rows.filter(
  (row) => row.group === "all_gold_read_answer_correct_guard"
);
const questionTypes = [...new Set(output.rows.map((row) => row.question_type))].sort();
const summary = {
  schema_version: 1,
  status: "complete",
  claim_boundary: {
    formal_end_to_end_score: false,
    gold_conditioned_diagnostic: true,
    evidence_selection_uses_gold: false,
    do_not_extrapolate_to_full300: true,
  },
  primary: {
    candidate_all_not_read_stage: pairedSummary(candidateRows),
    all_gold_read_answer_correct_guard: pairedSummary(guardRows),
  },
  pre_registered_current_judge_strata: {
    candidate_stage_currently_correct: pairedSummary(
      candidateRows.filter((row) => row.current_judge_correct)
    ),
    candidate_stage_currently_incorrect: pairedSummary(
      candidateRows.filter((row) => !row.current_judge_correct)
    ),
  },
  all_98_diagnostic_only: pairedSummary(output.rows),
  by_question_type_descriptive: Object.fromEntries(questionTypes.map((type) => [
    type,
    pairedSummary(output.rows.filter((row) => row.question_type === type)),
  ])),
  attempts: {
    answer: answers.attempt_audit,
    judge: output.attempt_audit,
  },
  cost: {
    answer_calls: 196,
    judge_calls: 196,
    total_model_calls: 392,
    answer_usage: sumUsage(answers.rows),
    answer_elapsed_seconds_sum: answers.rows.reduce(
      (total, row) => total + row.elapsed_seconds, 0
    ),
    judge_usage: "not returned by frozen official judge helper",
  },
  response_models: {
    answer: [...new Set(answers.rows.map((row) => row.response_model))].sort(),
    judge: [...new Set(output.rows.map((row) => row.response_model))].sort(),
  },
  artifacts: {
    preparation_sha256: input.preparation_sha256,
    answer_results_sha256: input.answer_results_sha256,
    judge_input_sha256: runManifest.judge_input_sha256,
    paired_results: outputPath,
    paired_results_sha256: sha256(readFileSync(outputPath)),
  },
};
const summaryPath = join(experiment, "analysis/paired-summary.json");
writeJsonDurable(summaryPath, summary);
runManifest.status = "complete";
runManifest.judge_results = outputPath;
runManifest.judge_results_sha256 = sha256(readFileSync(outputPath));
runManifest.summary = summaryPath;
runManifest.summary_sha256 = sha256(readFileSync(summaryPath));
runManifest.attempt_audit = summary.attempts;
writeJsonDurable(runManifestPath, runManifest);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
