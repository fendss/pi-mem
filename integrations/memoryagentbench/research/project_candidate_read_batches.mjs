#!/usr/bin/env node

/**
 * Deterministically project research read batches through the frozen production
 * evidence projector.  Input and output are JSON on stdin/stdout.  This helper
 * performs no network or model calls.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function usage(message) {
  throw new Error(
    `usage: project_candidate_read_batches.mjs --runtime-source DIR${
      message === undefined ? "" : `\n${message}`
    }`,
  );
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--runtime-source") {
    usage("a frozen runtime source is required");
  }
  return { runtimeSource: resolve(argv[1]) };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!Array.isArray(value?.batches)) throw new Error("input batches must be an array");
  return value;
}

const args = parseArgs(process.argv.slice(2));
const modulePath = join(args.runtimeSource, "dist/evidence-agent/index.js");
const moduleSource = await readFile(modulePath);
const {
  MAX_READ_RESULT_CHARS,
  projectMemoryEvidenceBatch,
  renderEvidenceExcerpts,
} = await import(pathToFileURL(modulePath).href);
const input = await readStdin();
const batches = input.batches.map((batch) => {
  if (typeof batch?.batchId !== "string" || !Array.isArray(batch.records)) {
    throw new Error("invalid projection batch");
  }
  const focusById = new Map(
    Object.entries(batch.focusByMemoryId ?? {}).map(([memoryId, focus]) => {
      if (!Array.isArray(focus) || focus.some((item) => typeof item !== "string")) {
        throw new Error(`invalid focus for ${memoryId}`);
      }
      return [memoryId, focus];
    }),
  );
  const evidence = projectMemoryEvidenceBatch(
    batch.records,
    (record) => focusById.get(record.memoryId) ?? [],
  );
  if (evidence.length !== batch.records.length) {
    throw new Error(`projection count changed for ${batch.batchId}`);
  }
  for (const item of evidence) {
    if (renderEvidenceExcerpts({
      sourceContentLength: item.sourceContentLength,
      excerpts: item.excerpts,
    }) !== item.content) {
      throw new Error(`production evidence renderer mismatch for ${item.memoryId}`);
    }
  }
  const renderedChars = evidence.reduce((total, item) => total + item.content.length, 0);
  if (renderedChars > MAX_READ_RESULT_CHARS) {
    throw new Error(`projected batch exceeds production read budget: ${batch.batchId}`);
  }
  return { batchId: batch.batchId, renderedChars, evidence };
});
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  projector: "projectMemoryEvidenceBatch",
  nodeVersion: process.version,
  runtimeModule: modulePath,
  runtimeModuleBytes: moduleSource.length,
  maxReadResultChars: MAX_READ_RESULT_CHARS,
  batches,
}));
