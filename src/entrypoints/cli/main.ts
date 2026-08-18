#!/usr/bin/env node
import { benchmarkLongMemEval } from "./commands/benchmark-longmemeval.js";
import { ingestLongMemEval } from "./commands/ingest-longmemeval.js";
import { longMemEvalSuite } from "./commands/longmemeval-suite.js";
import { packageBenchmark } from "./commands/package-benchmark.js";
import { prepareLongMemEvalEvaluation } from "./commands/prepare-longmemeval-eval.js";
import { runLongMemEval } from "./commands/run-longmemeval.js";
import { runGeneric } from "./commands/run-memory.js";
import { parseCommand } from "./parse-command.js";

function printHelp(): void {
  process.stdout.write(`PiMem \u2014 minimal source-grounded memory agent

Commands:
  ingest-longmemeval --source FILE --data-dir DIR [--question-id ID ...] [--retrieval-profile fts5|pimem-hybrid] [--embedding-slots N] [--embedding-rps N]
  run-longmemeval    --data-dir DIR --question-id ID [--retrieval-profile fts5|pimem-hybrid] [--model ID] [--skill none|pimem-v0]
  benchmark-longmemeval --data-dir DIR --output-dir DIR [--question-id ID ...] [--retrieval-profile fts5|pimem-hybrid] [--model ID] [--skill none|pimem-v0] [--slots N]
  longmemeval-suite --source FILE --data-dir DIR --output-dir DIR --embedding-env FILE --answer-env FILE --judge-env FILE --agent-dir DIR --provider ID --model ID --archive FILE.tar.gz --evaluation-archive FILE.tar.gz [--slots N] [--frozen-slots N] [--judge-slots N]
  prepare-longmemeval-eval --source FILE --predictions FILE --output FILE
  package-benchmark   --output-dir DIR --archive FILE.tar.gz
  run                 --data-dir DIR --scope ID --question TEXT [--question-date TEXT] [--retrieval-profile fts5|pimem-hybrid] [--model ID] [--skill none|pimem-v0]
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
