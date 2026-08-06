import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const sourceRoot = resolve(projectRoot, "src");
const codeCatalogPath = resolve(projectRoot, "docs", "architecture", "code-catalog.md");
const fileCatalogPath = resolve(projectRoot, "docs", "architecture", "file-catalog.md");

const FILE_RESPONSIBILITIES = new Map(Object.entries({
  "src/benchmark/answer-from-evidence.ts": "Runs the benchmark answer-only model stage from grounded retrieval evidence.",
  "src/benchmark/longmemeval/data-paths.ts": "Defines the filesystem paths used by a LongMemEval workspace.",
  "src/benchmark/longmemeval/dataset-adapter.ts": "Validates and adapts LongMemEval-S records into PiMem sessions and private questions.",
  "src/benchmark/longmemeval/private-question-store.ts": "Reads and atomically updates the private LongMemEval question map.",
  "src/benchmark/model/benchmark-query.ts": "Defines the benchmark question model shared at the benchmark boundary.",
  "src/benchmark/model/benchmark-run.ts": "Defines durable benchmark prediction, success, and failure artifact records.",
  "src/benchmark/use-cases/run-question.ts": "Composes the runtime needed to answer one question against one memory scope.",
  "src/composition/create-retrieval-context.ts": "Wires a concrete store and optional embedder into the selected retrieval profile.",
  "src/entrypoints/cli/commands/benchmark-longmemeval.ts": "Executes resumable, concurrent LongMemEval benchmark runs and materializes their artifacts.",
  "src/entrypoints/cli/commands/ingest-longmemeval.ts": "Ingests selected LongMemEval scopes and optionally builds embedding indexes.",
  "src/entrypoints/cli/commands/longmemeval-suite.ts": "Orchestrates the complete benchmark, audit, judge, frozen-reanswer, and packaging suite.",
  "src/entrypoints/cli/commands/package-benchmark.ts": "Validates complete benchmark artifacts and creates their archive.",
  "src/entrypoints/cli/commands/prepare-longmemeval-eval.ts": "Joins predictions with source answers into evaluator input records.",
  "src/entrypoints/cli/commands/run-longmemeval.ts": "Runs retrieval and answer generation for one stored private LongMemEval question.",
  "src/entrypoints/cli/commands/run-memory.ts": "Runs one arbitrary question against a selected memory scope.",
  "src/entrypoints/cli/main.ts": "Routes CLI commands and normalizes top-level errors.",
  "src/entrypoints/cli/parse-command.ts": "Parses CLI arguments, validates flags, and derives model and retrieval options.",
  "src/entrypoints/cli/workflow-files.ts": "Provides atomic workflow file writes, optional JSON reads, and archive command execution.",
  "src/entrypoints/ldbd-api/contracts.ts": "Validates and normalizes the LDBD Add/Search wire contracts.",
  "src/entrypoints/ldbd-api/inbox-store.ts": "Persists idempotent LDBD Add requests without benchmark questions or gold fields.",
  "src/entrypoints/ldbd-api/main.ts": "Starts the authenticated HTTP server for the LDBD memory API.",
  "src/entrypoints/ldbd-api/pimem-runtime.ts": "Materializes LDBD user messages as immutable scopes and runs PiMem retrieval.",
  "src/entrypoints/ldbd-api/service.ts": "Maps validated LDBD requests to inbox persistence and PiMem search.",
  "src/evidence-agent/adapters/docker/read-only-shell.ts": "Runs allowlisted read-only shell commands in the memory-scope container.",
  "src/evidence-agent/adapters/pi/ephemeral-context.ts": "Builds the bounded ephemeral context passed to the Pi agent.",
  "src/evidence-agent/adapters/pi/tools.ts": "Exports the Pi tool adapter API from its responsibility-specific modules.",
  "src/evidence-agent/adapters/pi/tools/bash-tool.ts": "Adapts the read-only shell capability to the Pi bash tool contract.",
  "src/evidence-agent/adapters/pi/tools/candidate-refs.ts": "Resolves and validates candidate references used by agent tools.",
  "src/evidence-agent/adapters/pi/tools/contracts.ts": "Defines stores, runtime state, and shared contracts required by Pi tools.",
  "src/evidence-agent/adapters/pi/tools/create-tools.ts": "Creates the complete Pi tool set for one evidence-agent run.",
  "src/evidence-agent/adapters/pi/tools/finish-tool.ts": "Validates and records the agent's final evidence-backed answer.",
  "src/evidence-agent/adapters/pi/tools/read-tool.ts": "Reads exact candidate memories and registers them as evidence.",
  "src/evidence-agent/adapters/pi/tools/render-tool-result.ts": "Renders structured tool results into the text observed by the agent.",
  "src/evidence-agent/adapters/pi/tools/schemas.ts": "Defines TypeBox input schemas for the Pi tools.",
  "src/evidence-agent/adapters/pi/tools/search-tool.ts": "Adapts retrieval orchestration to the Pi search-memory tool.",
  "src/evidence-agent/adapters/pi/tools/tool-protocol.ts": "Defines tool-call counting, time limits, and protocol errors.",
  "src/evidence-agent/model/evidence.ts": "Defines candidates, evidence, citations, metrics, and final agent results.",
  "src/evidence-agent/model/memory-ledger.ts": "Tracks searched candidates, exact reads, evidence, and provenance during a run.",
  "src/evidence-agent/prompts/question-plan.ts": "Builds question-specific retrieval planning guidance.",
  "src/evidence-agent/prompts/retrieval-guidance.ts": "Defines stable retrieval workflow guidance used in the system prompt.",
  "src/evidence-agent/run-pimem.ts": "Runs the Pi evidence agent and assembles its source-grounded result.",
  "src/memory/ingest-memory-sessions.ts": "Validates and ingests immutable memory sessions through the ingest port.",
  "src/memory/model/memory.ts": "Defines source-memory, session, scope, ingest, and export domain models.",
  "src/memory/ports/memory-ingest-store.ts": "Defines the store operations required by the memory ingest use case.",
  "src/platform/concurrency/async-pool.ts": "Runs bounded concurrent work with stable slot identities.",
  "src/platform/concurrency/request-gate.ts": "Limits concurrent requests and request-start rate.",
  "src/platform/filesystem/jsonl-writer.ts": "Serializes append-only JSONL writes through a single promise chain.",
  "src/platform/pi/load-model-runtime.ts": "Loads and validates the configured Pi model runtime.",
  "src/platform/pi/openai-non-stream-transport.ts": "Adapts complete OpenAI Chat Completions responses to the Pi agent event protocol.",
  "src/platform/security/protected-environment.ts": "Loads permission-restricted environment files and validates required variables.",
  "src/platform/sqlite/memory-row.ts": "Maps the shared SQLite memory row shape to the memory domain model.",
  "src/platform/sqlite/pimem-store.ts": "Implements memory persistence, FTS search, embedding storage, and fact gateways in SQLite.",
  "src/retrieval/adapters/openai/openai-compatible-embedder.ts": "Implements the embedder port with an OpenAI-compatible embeddings endpoint.",
  "src/retrieval/adapters/sqlite/database-evidence-operators.ts": "Implements temporal and numeric evidence-operator queries over SQLite.",
  "src/retrieval/adapters/sqlite/evidence-fact-index.ts": "Builds and inspects normalized temporal and numeric fact indexes in SQLite.",
  "src/retrieval/finalize-search-hits.ts": "Deduplicates, orders, and limits retrieval hits at the search boundary.",
  "src/retrieval/index-scope-embeddings.ts": "Builds or refreshes the embedding index for one memory scope.",
  "src/retrieval/model/embedder.ts": "Defines the technology-neutral embedding port.",
  "src/retrieval/model/embedding.ts": "Defines embedding profiles, stored vectors, and embedding-index contracts.",
  "src/retrieval/model/retrieval.ts": "Defines retrieval requests, hits, operators, profiles, coverage, and metrics.",
  "src/retrieval/operators/hybrid-search.ts": "Combines FTS and vector results using reciprocal-rank fusion.",
  "src/retrieval/operators/numeric-operator.ts": "Normalizes numeric constraints and executes numeric evidence queries.",
  "src/retrieval/operators/temporal-operator.ts": "Normalizes temporal constraints and executes temporal evidence queries.",
  "src/retrieval/ranking.ts": "Defines deterministic retrieval ranking and reciprocal-rank fusion helpers.",
  "src/retrieval/retrieval-profile.ts": "Resolves retrieval-profile names and creates profile-specific stores.",
  "src/retrieval/search-memory.ts": "Orchestrates request normalization, operator routing, coverage, expansion, and hit merging.",
  "src/retrieval/temporal-annotation.ts": "Parses and annotates temporal facts present in memory text.",
  "src/util.ts": "Provides shared hashing, safe path, source-text, and preview helpers.",
}));

const FUNCTION_PURPOSES = new Map(Object.entries({
  "src/benchmark/answer-from-evidence.ts#lastAssistantMessage": "Returns the final assistant message emitted by the answer model.",
  "src/benchmark/answer-from-evidence.ts#assistantText": "Extracts plain text from an assistant message.",
  "src/benchmark/answer-from-evidence.ts#returnedModelMatches": "Checks whether the provider's response model matches the requested model.",
  "src/benchmark/longmemeval/data-paths.ts#dataPaths": "Derives all persistent LongMemEval paths from one data directory.",
  "src/evidence-agent/adapters/pi/tools/search-tool.ts#createSearchTool": "Creates the Pi search tool that delegates retrieval and records returned candidates in the ledger.",
  "src/evidence-agent/run-pimem.ts#orderCandidatesForEvidenceAttention": "Orders candidate memories for stable evidence review without changing their provenance.",
  "src/evidence-agent/run-pimem.ts#questionPrompt": "Builds the user prompt from the question and optional question date.",
  "src/evidence-agent/run-pimem.ts#lastAssistantMessage": "Returns the final assistant message from the Pi conversation.",
  "src/evidence-agent/run-pimem.ts#assistantText": "Extracts plain text from the final assistant message.",
  "src/evidence-agent/run-pimem.ts#runPiMem": "Runs one bounded evidence-agent session and returns its provenance-backed result.",
  "src/entrypoints/ldbd-api/contracts.ts#parseAddRequest": "Validates one synchronous LDBD Add request and keeps only the memory contract fields.",
  "src/entrypoints/ldbd-api/contracts.ts#parseSearchRequest": "Validates one LDBD Search request with a bounded top-k and optional choices.",
  "src/entrypoints/ldbd-api/contracts.ts#renderRetrievalQuestion": "Adds benchmark options to the retrieval question without persisting them as memory.",
  "src/entrypoints/ldbd-api/inbox-store.ts#LdbdInboxStore.put": "Persists an Add request idempotently and rejects request-ID content conflicts.",
  "src/entrypoints/ldbd-api/inbox-store.ts#LdbdInboxStore.listForUser": "Returns one user's Add requests in durable insertion order.",
  "src/entrypoints/ldbd-api/pimem-runtime.ts#PiMemLdbdRuntime.search": "Builds an immutable user snapshot, runs PiMem, and returns cited memories in LDBD form.",
  "src/entrypoints/ldbd-api/service.ts#LdbdApiService.add": "Handles the synchronous LDBD Add operation.",
  "src/entrypoints/ldbd-api/service.ts#LdbdApiService.search": "Handles the LDBD Search operation through the injected search engine.",
  "src/retrieval/search-memory.ts#normalizeStrings": "Validates, trims, and deduplicates a list of search values.",
  "src/retrieval/search-memory.ts#makeSearchRequest": "Builds a normalized retrieval request with stable default limits and ordering.",
  "src/retrieval/search-memory.ts#searchQueryFingerprint": "Creates a canonical fingerprint used to detect repeated queries.",
  "src/retrieval/search-memory.ts#mergeOperatorHits": "Merges operator-preferred and fallback hits without duplicate memories.",
  "src/retrieval/search-memory.ts#coverageHits": "Runs each query separately and merges results to preserve multi-query coverage.",
  "src/retrieval/search-memory.ts#createSearchMemory": "Creates the search orchestrator for normalization, routing, coverage, expansion, and hit merging.",
  "src/platform/sqlite/pimem-store.ts#ftsQuery": "Converts free text into a bounded, escaped SQLite FTS5 OR query.",
  "src/platform/sqlite/pimem-store.ts#MemoryStore.ingestScope": "Atomically persists one immutable memory scope and reports whether it was inserted or reused.",
  "src/platform/sqlite/pimem-store.ts#MemoryStore.search": "Executes filtered FTS5 search and returns finalized retrieval hits.",
  "src/platform/sqlite/pimem-store.ts#MemoryStore.read": "Reads exact memories by ID within one scope.",
  "src/platform/sqlite/pimem-store.ts#MemoryStore.exportScope": "Writes a sanitized, permission-restricted filesystem export of one scope.",
  "src/platform/pi/openai-non-stream-transport.ts#resolvedMessageCompat": "Resolves the OpenAI message-conversion compatibility settings for a model.",
  "src/platform/pi/openai-non-stream-transport.ts#requestHeaders": "Builds authenticated JSON request headers without persisting the API key.",
  "src/platform/pi/openai-non-stream-transport.ts#serializedTools": "Serializes Pi function tools for an OpenAI-compatible request.",
  "src/platform/pi/openai-non-stream-transport.ts#buildPayload": "Builds a non-streaming Chat Completions request from Pi model context.",
  "src/platform/pi/openai-non-stream-transport.ts#asObject": "Validates that an untrusted protocol value is a JSON object.",
  "src/platform/pi/openai-non-stream-transport.ts#nonNegativeInteger": "Normalizes an untrusted usage counter to a non-negative integer.",
  "src/platform/pi/openai-non-stream-transport.ts#responseUsage": "Maps provider token usage and model rates to Pi usage metadata.",
  "src/platform/pi/openai-non-stream-transport.ts#responseText": "Extracts text from an OpenAI-compatible assistant response.",
  "src/platform/pi/openai-non-stream-transport.ts#responseThinking": "Extracts optional reasoning text and its provider field name.",
  "src/platform/pi/openai-non-stream-transport.ts#responseToolCalls": "Validates and maps complete provider tool calls to Pi tool-call blocks.",
  "src/platform/pi/openai-non-stream-transport.ts#finishReason": "Maps an OpenAI finish reason to the Pi stop-reason contract.",
  "src/platform/pi/openai-non-stream-transport.ts#errorMessageFromBody": "Extracts a bounded provider error message from an HTTP response body.",
  "src/platform/pi/openai-non-stream-transport.ts#emitCompletedMessage": "Emits one complete assistant response through the Pi event protocol.",
  "src/platform/pi/openai-non-stream-transport.ts#openAINonStreamingStreamFn": "Executes one non-streaming Chat Completions request and exposes it as a Pi event stream.",
  "src/evidence-agent/model/memory-ledger.ts#MemoryLedger.recordSearchHits": "Registers retrieval hits as candidates while preserving first-seen provenance.",
  "src/evidence-agent/model/memory-ledger.ts#MemoryLedger.recordRead": "Registers exact memory reads and promotes them to eligible evidence.",
  "src/evidence-agent/model/memory-ledger.ts#MemoryLedger.acceptSelection": "Validates and stores the agent's final evidence selection.",
  "src/evidence-agent/model/memory-ledger.ts#MemoryLedger.assertInvariants": "Verifies candidate, evidence, citation, and scope provenance invariants.",
}));

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat().sort();
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function visibility(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ? "exported"
    : "internal";
}

function parameters(node, sourceFile) {
  return node.parameters
    .map((parameter) => parameter.getText(sourceFile).replace(/\s+/gu, " "))
    .join(", ");
}

function returnType(node, sourceFile) {
  return node.type ? `: ${node.type.getText(sourceFile).replace(/\s+/gu, " ")}` : "";
}

function jsDocPurpose(node) {
  const documentation = ts.getJSDocCommentsAndTags(node)
    .find((item) => ts.isJSDoc(item));
  if (!documentation?.comment) return undefined;
  const comment = typeof documentation.comment === "string"
    ? documentation.comment
    : documentation.comment.map((part) => part.text).join("");
  const normalized = comment.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/u)?.[0] ?? normalized;
  return sentence.trim();
}

function humanizeIdentifier(identifier) {
  return identifier
    .replace(/^#/, "")
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function inferredPurpose(identifier, kind, className) {
  if (kind === "class") return `Implements ${humanizeIdentifier(identifier)}.`;
  if (identifier === "constructor") {
    return `Creates a ${humanizeIdentifier(className)} instance.`;
  }
  const exactOperations = new Map([
    ["search", "Performs a search."],
    ["read", "Reads the requested value."],
    ["load", "Loads the requested resource."],
    ["run", "Runs the operation."],
    ["close", "Closes owned resources."],
  ]);
  if (exactOperations.has(identifier)) return exactOperations.get(identifier);
  const rules = [
    ["assert", "Validates", " and throws when invalid"],
    ["normalize", "Normalizes", ""],
    ["materialize", "Materializes", ""],
    ["finalize", "Finalizes", ""],
    ["serialize", "Serializes", ""],
    ["deserialize", "Deserializes", ""],
    ["create", "Creates", ""],
    ["build", "Builds", ""],
    ["collect", "Collects", ""],
    ["compare", "Compares", ""],
    ["execute", "Executes", ""],
    ["prepare", "Prepares", ""],
    ["package", "Packages", ""],
    ["resolve", "Resolves", ""],
    ["register", "Registers", ""],
    ["validate", "Validates", ""],
    ["render", "Renders", ""],
    ["adapt", "Adapts", ""],
    ["parse", "Parses", ""],
    ["merge", "Merges", ""],
    ["search", "Searches", ""],
    ["index", "Indexes", ""],
    ["load", "Loads", ""],
    ["read", "Reads", ""],
    ["write", "Writes", ""],
    ["run", "Runs", ""],
    ["get", "Returns", ""],
    ["set", "Sets", ""],
    ["to", "Converts", ""],
  ];
  for (const [prefix, verb, suffix] of rules) {
    if (!identifier.startsWith(prefix) || identifier.length === prefix.length) continue;
    return `${verb} ${humanizeIdentifier(identifier.slice(prefix.length))}${suffix}.`;
  }
  for (const prefix of ["is", "has", "can", "should"]) {
    if (!identifier.startsWith(prefix) || identifier.length === prefix.length) continue;
    return `Checks whether ${humanizeIdentifier(identifier.slice(prefix.length))}.`;
  }
  return `Implements the ${humanizeIdentifier(identifier)} operation.`;
}

function purpose(node, identifier, kind, className) {
  const projectPath = relative(projectRoot, node.getSourceFile().fileName)
    .replace(/\\/gu, "/");
  const key = `${projectPath}#${className ? `${className}.` : ""}${identifier}`;
  return FUNCTION_PURPOSES.get(key) ??
    jsDocPurpose(node) ??
    inferredPurpose(identifier, kind, className);
}

function memberVisibility(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) {
    return "private";
  }
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) {
    return "protected";
  }
  return "public";
}

function declarationRows(sourceFile) {
  const rows = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      rows.push({
        symbol: `${statement.name.text}(${parameters(statement, sourceFile)})${returnType(statement, sourceFile)}`,
        kind: "function",
        visibility: visibility(statement),
        purpose: purpose(statement, statement.name.text, "function"),
        line: lineNumber(sourceFile, statement),
      });
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      rows.push({
        symbol: statement.name.text,
        kind: "class",
        visibility: visibility(statement),
        purpose: purpose(statement, statement.name.text, "class"),
        line: lineNumber(sourceFile, statement),
      });
      for (const member of statement.members) {
        if (
          (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) ||
          (!ts.isConstructorDeclaration(member) && !member.name)
        ) continue;
        const memberName = ts.isConstructorDeclaration(member)
          ? "constructor"
          : member.name.getText(sourceFile);
        rows.push({
          symbol: `${statement.name.text}.${memberName}(${parameters(member, sourceFile)})${returnType(member, sourceFile)}`,
          kind: "method",
          visibility: memberVisibility(member),
          purpose: purpose(member, memberName, "method", statement.name.text),
          line: lineNumber(sourceFile, member),
        });
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))
      ) {
        continue;
      }
      rows.push({
        symbol: `${declaration.name.text}(${parameters(declaration.initializer, sourceFile)})${returnType(declaration.initializer, sourceFile)}`,
        kind: "function",
        visibility: visibility(statement),
        purpose: purpose(declaration, declaration.name.text, "function"),
        line: lineNumber(sourceFile, declaration),
      });
    }
  }
  return rows;
}

function markdown(files) {
  const sections = files.map(({ projectPath, rows }) => {
    const body = rows.length === 0
      ? "_No top-level functions, classes, or class methods._"
      : [
          "| Symbol | Purpose | Kind | Visibility | Source |",
          "|---|---|---|---|---|",
          ...rows.map((row) =>
            `| \`${row.symbol.replace(/\|/gu, "\\|")}\` | ${row.purpose.replace(/\|/gu, "\\|")} | ${row.kind} | ${row.visibility} | [line ${row.line}](../../${projectPath.replace(/\\/gu, "/")}#L${row.line}) |`
          ),
        ].join("\n");
    return `## \`${projectPath.replace(/\\/gu, "/")}\`\n\n${body}`;
  });
  return [
    "# Code Catalog",
    "",
    "This file is generated from the TypeScript AST. It is the function-level directory for the project and must not be edited manually.",
    "",
    "Run `npm run docs:catalog` after adding, removing, renaming, or moving source symbols.",
    "",
    ...sections,
    "",
  ].join("\n");
}

function contextFor(projectPath) {
  const [, topLevel] = projectPath.split("/");
  const contexts = new Set(["memory", "retrieval", "evidence-agent", "benchmark"]);
  if (contexts.has(topLevel)) return topLevel;
  if (["entrypoints", "composition", "platform"].includes(topLevel)) return topLevel;
  return projectPath === "src/util.ts" ? "shared" : "compatibility";
}

function isCompatibilityFacade(projectPath, source) {
  return contextFor(projectPath) === "compatibility" ||
    source.includes("Compatibility facade");
}

function layerFor(projectPath, source) {
  if (isCompatibilityFacade(projectPath, source)) return "compatibility facade";
  if (projectPath.endsWith("/index.ts")) return "public API";
  if (projectPath.includes("/model/")) return "model";
  if (projectPath.includes("/ports/")) return "port";
  if (projectPath.includes("/adapters/")) return "adapter";
  if (projectPath.includes("/operators/")) return "operator";
  if (projectPath.includes("/use-cases/")) return "use case";
  if (projectPath.includes("/prompts/")) return "prompt policy";
  if (projectPath.includes("/entrypoints/cli/commands/")) return "command handler";
  if (projectPath === "src/entrypoints/cli/main.ts") return "entry point";
  if (projectPath.startsWith("src/entrypoints/")) return "entrypoint support";
  if (projectPath.startsWith("src/composition/")) return "composition root";
  if (projectPath.startsWith("src/platform/")) return "platform adapter";
  return "domain service";
}

function facadeResponsibility(source) {
  const targets = [...source.matchAll(/(?:from\s+|import\s*)["'](.+?)["']/gu)]
    .map((match) => `\`${match[1]}\``);
  return targets.length === 0
    ? "Preserves a pre-refactor import path."
    : `Preserves a pre-refactor import path by re-exporting ${targets.join(", ")}.`;
}

function fileResponsibility(projectPath, source) {
  if (isCompatibilityFacade(projectPath, source)) return facadeResponsibility(source);
  const configured = FILE_RESPONSIBILITIES.get(projectPath);
  if (configured) return configured;
  if (projectPath.endsWith("/index.ts")) {
    return `Defines the public API exported by the ${contextFor(projectPath)} context.`;
  }
  throw new Error(`Missing file responsibility for ${projectPath}`);
}

function fileCatalogMarkdown(files) {
  const rows = files.map(({ projectPath, source }) => {
    const layer = layerFor(projectPath, source);
    const status = layer === "compatibility facade"
      ? "compatibility"
      : layer === "public API"
        ? "public"
        : "internal";
    return `| [\`${projectPath}\`](../../${projectPath}) | ${contextFor(projectPath)} | ${layer} | ${status} | ${fileResponsibility(projectPath, source)} |`;
  });
  return [
    "# File Catalog",
    "",
    "This generated catalog is the file-level directory for the project. Responsibilities are maintained in `scripts/generate-code-catalog.mjs`; generation fails when a primary source file has no description.",
    "",
    "Compatibility facades preserve old import paths during the structural migration. New code must import from the context path named by the facade.",
    "",
    "| File | Context | Layer | Status | Responsibility |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const files = await listTypeScriptFiles(sourceRoot);
const catalogEntries = await Promise.all(files.map(async (path) => {
  const source = await readFile(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return {
    projectPath: relative(projectRoot, path).replace(/\\/gu, "/"),
    source,
    rows: declarationRows(sourceFile),
  };
}));
const generatedCodeCatalog = markdown(catalogEntries);
const generatedFileCatalog = fileCatalogMarkdown(catalogEntries);

if (process.argv.includes("--check")) {
  const [currentCodeCatalog, currentFileCatalog] = await Promise.all([
    readFile(codeCatalogPath, "utf8").catch(() => ""),
    readFile(fileCatalogPath, "utf8").catch(() => ""),
  ]);
  if (
    currentCodeCatalog !== generatedCodeCatalog ||
    currentFileCatalog !== generatedFileCatalog
  ) {
    throw new Error("Architecture catalogs are stale. Run `npm run docs:catalog`.");
  }
} else {
  await Promise.all([
    writeFile(codeCatalogPath, generatedCodeCatalog, "utf8"),
    writeFile(fileCatalogPath, generatedFileCatalog, "utf8"),
  ]);
}
