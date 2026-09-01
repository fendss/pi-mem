#!/usr/bin/env node

/**
 * Post-hoc retrieval ablation for MemoryAgentBench LongMemEval-S.
 *
 * This script never calls the retrieval Agent or the answer model. Gold memory
 * IDs are read from diagnose_longmemeval_pipeline.py output and are used only
 * to score candidate pools (and in the explicitly labelled oracle-rerank arm).
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { MemoryStore } from "../../../dist/platform/sqlite/pimem-store.js";
import { HybridMemoryStore } from "../../../dist/retrieval/operators/hybrid-search.js";
import { OpenAICompatibleEmbedder } from "../../../dist/retrieval/adapters/openai/openai-compatible-embedder.js";

const DEFAULT_DEPTHS = [20, 40, 60, 80, 100];
const DEFAULT_TARGET_STAGES = ["no_gold_candidate", "partial_gold_candidates"];
const DEFAULT_ANCHOR_COUNTS = [5, 10];
const DEFAULT_NEIGHBOR_RADII = [1, 2];
const DEFAULT_SECONDARY_LIMIT = 20;

function usage(message) {
  const suffix = message === undefined ? "" : `\n\n${message}`;
  throw new Error(
    "usage: oracle_retrieval_ablation.mjs " +
      "--diagnostic FILE --artifact FILE --audit FILE --sqlite FILE --output FILE " +
      "[--question-ids ID,ID|FILE] [--target-stages STAGE,STAGE] " +
      "[--depths 20,40,60,80,100] [--anchor-counts 5,10] " +
      "[--neighbor-radii 1,2] [--secondary-limit 20]" + suffix,
  );
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) usage(`unexpected argument: ${String(flag)}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usage(`missing value for ${flag}`);
    }
    values[flag.slice(2)] = value;
    index += 1;
  }
  for (const required of ["diagnostic", "artifact", "audit", "sqlite", "output"]) {
    if (!values[required]) usage(`missing --${required}`);
  }
  const integerList = (name, fallback) => {
    const raw = values[name];
    if (raw === undefined) return fallback;
    const parsed = raw.split(",").map((item) => Number(item.trim()));
    if (parsed.length === 0 || parsed.some((item) =>
      !Number.isSafeInteger(item) || item <= 0
    )) {
      usage(`--${name} must be a comma-separated list of positive integers`);
    }
    return [...new Set(parsed)].sort((left, right) => left - right);
  };
  const secondaryLimit = Number(values["secondary-limit"] ?? DEFAULT_SECONDARY_LIMIT);
  if (!Number.isSafeInteger(secondaryLimit) || secondaryLimit <= 0 || secondaryLimit > 100) {
    usage("--secondary-limit must be an integer in [1, 100]");
  }
  return {
    diagnostic: resolve(values.diagnostic),
    artifact: resolve(values.artifact),
    audit: resolve(values.audit),
    sqlite: resolve(values.sqlite),
    output: resolve(values.output),
    questionIds: values["question-ids"],
    targetStages: values["target-stages"]?.split(",").map((item) => item.trim())
      .filter(Boolean) ?? DEFAULT_TARGET_STAGES,
    depths: integerList("depths", DEFAULT_DEPTHS),
    anchorCounts: integerList("anchor-counts", DEFAULT_ANCHOR_COUNTS),
    neighborRadii: integerList("neighbor-radii", DEFAULT_NEIGHBOR_RADII),
    secondaryLimit,
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function orderedUnique(values) {
  return [...new Map(values.map((value) => [value, value])).values()];
}

function scopeFromAudit(audit) {
  for (const evidence of audit.retrieval?.evidence ?? []) {
    if (typeof evidence.scopeId === "string") return evidence.scopeId;
  }
  for (const step of audit.retrieval?.trace ?? []) {
    for (const candidate of step.details?.candidates ?? []) {
      if (typeof candidate.scopeId === "string") return candidate.scopeId;
    }
  }
  return undefined;
}

function requestFilters(request, roles, maxPerSession) {
  const output = {};
  for (const key of ["sessionIds", "after", "before"]) {
    if (request?.[key] !== undefined) output[key] = request[key];
  }
  if (roles !== undefined) output.roles = [...roles];
  else if (request?.roles !== undefined) output.roles = [...request.roles];
  if (maxPerSession !== undefined) output.maxPerSession = maxPerSession;
  return output;
}

/** Extract one semantic call per successful Agent `search`, not per search_more page. */
export function extractSemanticCalls(audit) {
  const calls = [];
  for (const step of audit.retrieval?.trace ?? []) {
    const details = step.details;
    if (
      step.toolName !== "search" || step.isError !== false ||
      details?.kind !== "search"
    ) continue;
    const request = details.request ?? {};
    const compositionSearches = (details.composition?.steps ?? [])
      .filter((item) => item.kind === "search");
    const queries = orderedUnique(
      compositionSearches.length === 0
        ? (details.executedQueries ?? request.queries ?? [])
        : compositionSearches.flatMap((item) => item.queries ?? []),
    ).filter((item) => typeof item === "string" && item.trim().length > 0);
    if (queries.length === 0) continue;
    const composedRoles = orderedUnique(
      compositionSearches.flatMap((item) => item.roles ?? []),
    );
    calls.push({
      step: step.step,
      queries,
      filters: requestFilters(
        request,
        composedRoles.length === 0 ? undefined : composedRoles,
        undefined,
      ),
      originalLimit: request.limit,
    });
  }
  return calls;
}

export function observedCandidateIds(audit) {
  return orderedUnique(
    (audit.retrieval?.trace ?? []).flatMap((step) =>
      step.details?.kind === "search"
        ? (step.details.candidates ?? []).map((candidate) => candidate.memoryId)
        : []
    ).filter((value) => typeof value === "string"),
  );
}

/** Exact ordered counterpart of diagnose_longmemeval_pipeline.py `_candidate_ids`. */
export function observedRetrievalCandidateIds(audit) {
  return orderedUnique(
    (audit.retrieval?.trace ?? []).flatMap((step) =>
      (step.details?.candidates ?? []).map((candidate) => candidate.memoryId)
    ).filter((value) => typeof value === "string"),
  );
}

export function rrfFuse(rankings, limit, k = 60) {
  const scores = new Map();
  const firstSeen = new Map();
  let ordinal = 0;
  for (const ranking of rankings) {
    const seen = new Set();
    ranking.forEach((memoryId, index) => {
      if (seen.has(memoryId)) return;
      seen.add(memoryId);
      if (!firstSeen.has(memoryId)) firstSeen.set(memoryId, ordinal++);
      scores.set(memoryId, (scores.get(memoryId) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores]
    .sort((left, right) =>
      right[1] - left[1] || firstSeen.get(left[0]) - firstSeen.get(right[0])
    )
    .slice(0, limit)
    .map(([memoryId]) => memoryId);
}

/** Dates already written by the Agent into its own retrieval queries. */
export function queryDateLiterals(calls) {
  return orderedUnique(calls.flatMap((call) =>
    call.queries.flatMap((query) =>
      (query.match(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/gu) ?? [])
        .map((value) => value.replaceAll("/", "-"))
    )
  ));
}

function groupCovered(group, ids) {
  return group.some((memoryId) => ids.has(memoryId));
}

export function coverage(ids, groups, recordsById = new Map()) {
  const ordered = orderedUnique(ids);
  const set = new Set(ordered);
  const groupRanks = groups.map((group) => {
    const ranks = group.flatMap((memoryId) => {
      const index = ordered.indexOf(memoryId);
      return index < 0 ? [] : [index + 1];
    });
    return ranks.length === 0 ? null : Math.min(...ranks);
  });
  const sessions = new Set(ordered.flatMap((memoryId) => {
    const record = recordsById.get(memoryId);
    return record === undefined ? [] : [record.sessionId];
  }));
  const coveredGroups = groups.filter((group) => groupCovered(group, set)).length;
  return {
    candidate_count: ordered.length,
    distinct_sessions: sessions.size,
    covered_gold_groups: coveredGroups,
    gold_group_count: groups.length,
    gold_any: coveredGroups > 0,
    gold_all: groups.length > 0 && coveredGroups === groups.length,
    gold_group_best_ranks: groupRanks,
    candidate_ids: ordered,
  };
}

/** Gold-aware ordering used only for a labelled diagnostic upper bound. */
export function oracleCoverageOrder(ids, groups, limit) {
  const source = orderedUnique(ids);
  const sourceSet = new Set(source);
  const selected = [];
  const selectedSet = new Set();
  for (const group of groups) {
    const representative = source.find((memoryId) =>
      group.includes(memoryId) && sourceSet.has(memoryId) && !selectedSet.has(memoryId)
    );
    if (representative !== undefined) {
      selected.push(representative);
      selectedSet.add(representative);
    }
  }
  for (const memoryId of source) {
    if (!selectedSet.has(memoryId)) selected.push(memoryId);
  }
  return selected.slice(0, limit);
}

class MutableCachedEmbedder {
  constructor(inner) {
    this.inner = inner;
    this.vectors = new Map();
    this.profileId = inner.profileId;
    this.model = inner.model;
    this.dimensions = inner.dimensions;
    this.maxInputLength = inner.maxInputLength;
    this.batchSize = inner.batchSize;
  }

  async add(texts) {
    const missing = orderedUnique(texts).filter((text) => !this.vectors.has(text));
    if (missing.length === 0) return;
    const vectors = await this.inner.embedQueries(missing);
    missing.forEach((text, index) => this.vectors.set(text, vectors[index]));
  }

  embedQueries(texts) {
    return Promise.resolve(texts.map((text) => {
      const vector = this.vectors.get(text);
      if (vector === undefined) throw new Error(`uncached query: ${text.slice(0, 80)}`);
      return vector;
    }));
  }

  embedDocuments(texts) {
    return this.embedQueries(texts);
  }

  snapshotMetrics() {
    return this.inner.snapshotMetrics();
  }
}

async function snapshotSqlite(sourcePath) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pimem-oracle-ablation-"));
  const snapshotPath = join(temporaryRoot, "snapshot.sqlite");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, snapshotPath);
  } finally {
    source.close();
  }
  return { temporaryRoot, snapshotPath };
}

async function runBackendCalls(store, backend, scopeId, calls, limit, maxPerSession) {
  const rankings = [];
  for (const call of calls) {
    const request = {
      ...call.filters,
      queries: call.queries,
      limit,
      ...(maxPerSession === undefined ? {} : { maxPerSession }),
    };
    const hits = backend === "hybrid"
      ? await store.search(scopeId, request)
      : store.searchLexical(scopeId, request);
    rankings.push(hits.map((hit) => hit.record.memoryId));
  }
  return orderedUnique(rankings.flat());
}

async function runSplitQueries(store, backend, scopeId, calls, limit) {
  const rankings = [];
  for (const call of calls) {
    for (const query of call.queries) {
      const request = { ...call.filters, queries: [query], limit };
      const hits = backend === "hybrid"
        ? await store.search(scopeId, request)
        : store.searchLexical(scopeId, request);
      rankings.push(hits.map((hit) => hit.record.memoryId));
    }
  }
  return {
    union: orderedUnique(rankings.flat()),
    rrfTop20: rrfFuse(rankings, 20),
    rrfTop40: rrfFuse(rankings, 40),
    rankingCount: rankings.length,
  };
}

function addArm(arms, name, ids, groups, recordsById, metadata = {}) {
  arms[name] = {
    ...coverage(ids, groups, recordsById),
    uses_gold_during_retrieval: false,
    ...metadata,
  };
}

async function parseQuestionIdFilter(value) {
  if (value === undefined) return undefined;
  try {
    const source = await readFile(resolve(value), "utf8");
    const values = source.trim().startsWith("[")
      ? JSON.parse(source)
      : source.split(/\r?\n/u).filter(Boolean);
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string")) {
      throw new Error("question ID file must be a JSON array or one ID per line");
    }
    return new Set(values);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
  }
}

function summarize(rows, armOrder) {
  const armSummary = {};
  for (const name of armOrder) {
    const values = rows.map((row) => row.arms[name]).filter(Boolean);
    if (values.length === 0) continue;
    armSummary[name] = {
      queries: values.length,
      gold_any_queries: values.filter((arm) => arm.gold_any).length,
      gold_all_queries: values.filter((arm) => arm.gold_all).length,
      mean_candidates: values.reduce((sum, arm) => sum + arm.candidate_count, 0) /
        values.length,
      mean_sessions: values.reduce((sum, arm) => sum + arm.distinct_sessions, 0) /
        values.length,
    };
  }
  const classCounts = {};
  for (const row of rows) {
    classCounts[row.recovery_class] = (classCounts[row.recovery_class] ?? 0) + 1;
  }
  return {
    targets: rows.length,
    original_stages: Object.fromEntries(sortedUnique(rows.map((row) => row.original_stage))
      .map((stage) => [stage, rows.filter((row) => row.original_stage === stage).length])),
    recovery_classes: classCounts,
    arms: armSummary,
  };
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${String(process.pid)}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [diagnostic, artifact, auditText, questionIdFilter] = await Promise.all([
    readFile(options.diagnostic, "utf8").then(JSON.parse),
    readFile(options.artifact, "utf8").then(JSON.parse),
    readFile(options.audit, "utf8"),
    parseQuestionIdFilter(options.questionIds),
  ]);
  const artifactRows = new Map(
    artifact.data.map((row) => [row.benchmark_query_id, row]),
  );
  const questionToId = new Map();
  for (const row of artifact.data) {
    if (questionToId.has(row.query)) {
      throw new Error(`duplicate question text cannot be mapped safely: ${row.query}`);
    }
    questionToId.set(row.query, row.benchmark_query_id);
  }
  const audits = new Map();
  const scopeByUser = new Map();
  for (const line of auditText.split(/\r?\n/u)) {
    if (!line) continue;
    const audit = JSON.parse(line);
    const questionId = questionToId.get(audit.question);
    if (questionId === undefined) continue;
    audits.set(questionId, audit);
    const scopeId = scopeFromAudit(audit);
    if (typeof audit.userId === "string" && scopeId !== undefined) {
      const existing = scopeByUser.get(audit.userId);
      if (existing !== undefined && existing !== scopeId) {
        throw new Error(`user ${audit.userId} resolves to multiple scopes`);
      }
      scopeByUser.set(audit.userId, scopeId);
    }
  }

  const targetStageSet = new Set(options.targetStages);
  const targets = diagnostic.rows.filter((row) =>
    targetStageSet.has(row.stage) &&
    (questionIdFilter === undefined || questionIdFilter.has(row.benchmark_query_id))
  );
  if (targets.length === 0) throw new Error("no diagnostic rows matched the target filter");
  for (const target of targets) {
    if (!artifactRows.has(target.benchmark_query_id)) {
      throw new Error(`artifact is missing ${target.benchmark_query_id}`);
    }
    if (!audits.has(target.benchmark_query_id)) {
      throw new Error(`audit is missing ${target.benchmark_query_id}`);
    }
    if (!Array.isArray(target.gold_source_groups) || target.gold_source_groups.length === 0) {
      throw new Error(`target has no resolved gold groups: ${target.benchmark_query_id}`);
    }
  }

  const targetInputs = targets.map((target) => {
    const audit = audits.get(target.benchmark_query_id);
    const directScope = scopeFromAudit(audit);
    const scopeId = directScope ?? scopeByUser.get(audit.userId);
    if (scopeId === undefined) {
      throw new Error(`cannot resolve scope for ${target.benchmark_query_id}`);
    }
    const calls = extractSemanticCalls(audit);
    if (calls.length === 0) {
      throw new Error(`no successful semantic search for ${target.benchmark_query_id}`);
    }
    return {
      target,
      audit,
      artifactRow: artifactRows.get(target.benchmark_query_id),
      scopeId,
      calls,
      observedSearch: observedCandidateIds(audit),
      observedRetrieval: observedRetrievalCandidateIds(audit),
    };
  });

  const baseEmbedder = OpenAICompatibleEmbedder.fromEnvironment();
  const embedder = new MutableCachedEmbedder(baseEmbedder);
  await embedder.add(targetInputs.flatMap((input) =>
    input.calls.flatMap((call) => call.queries)
  ));

  const snapshot = await snapshotSqlite(options.sqlite);
  const rawStore = new MemoryStore(snapshot.snapshotPath);
  const hybridStore = new HybridMemoryStore(rawStore, embedder);
  const scopeRecords = new Map();
  const intermediate = [];
  try {
    for (const input of targetInputs) {
      let recordsById = scopeRecords.get(input.scopeId);
      if (recordsById === undefined) {
        recordsById = new Map(rawStore.listScopeRecords(input.scopeId)
          .map((record) => [record.memoryId, record]));
        scopeRecords.set(input.scopeId, recordsById);
      }
      const groups = input.target.gold_source_groups;
      const arms = {};
      addArm(arms, "observed_search", input.observedSearch, groups, recordsById, {
        description: "Candidates exposed by historical search/search_more results only.",
      });
      addArm(
        arms,
        "observed_retrieval",
        input.observedRetrieval,
        groups,
        recordsById,
        {
          description: "All candidates recorded anywhere in the historical retrieval trace, exactly matching the pipeline diagnostic candidate boundary.",
        },
      );
      const armOrder = ["observed_search", "observed_retrieval"];
      const depthResults = { hybrid: new Map(), lexical: new Map() };
      for (const depth of options.depths) {
        for (const backend of ["hybrid", "lexical"]) {
          const ids = await runBackendCalls(
            hybridStore,
            backend,
            input.scopeId,
            input.calls,
            depth,
          );
          const name = `${backend}_depth_${String(depth)}`;
          depthResults[backend].set(depth, ids);
          addArm(arms, name, ids, groups, recordsById, {
            description: `All historical query strings replayed with ${backend} at depth ${String(depth)} per semantic call.`,
          });
          armOrder.push(name);
        }
      }
      const splitDepth = options.depths.includes(20) ? 20 : options.depths[0];
      const splitDepths = sortedUnique([splitDepth, Math.max(...options.depths)]);
      for (const backend of ["hybrid", "lexical"]) {
        for (const perQueryDepth of splitDepths) {
          const split = await runSplitQueries(
            hybridStore,
            backend,
            input.scopeId,
            input.calls,
            perQueryDepth,
          );
          const unionName = `${backend}_split_${String(perQueryDepth)}_union_all`;
          addArm(arms, unionName, split.union, groups, recordsById, {
            description: `Independent per-query top-${String(perQueryDepth)} rankings, unbounded union; candidate cost is reported.`,
            ranking_count: split.rankingCount,
          });
          armOrder.push(unionName);
          for (const [rrfLimit, ids] of [
            [20, split.rrfTop20],
            [40, split.rrfTop40],
          ]) {
            const rrfName = `${backend}_split_${String(perQueryDepth)}_rrf_top_${String(rrfLimit)}`;
            addArm(arms, rrfName, ids, groups, recordsById, {
              description: `Independent per-query top-${String(perQueryDepth)} rankings fused by RRF to one fixed top-${String(rrfLimit)} view.`,
              ranking_count: split.rankingCount,
              candidate_budget: rrfLimit,
            });
            armOrder.push(rrfName);
          }
        }
      }
      for (const maxPerSession of [1, 2]) {
        const ids = await runBackendCalls(
          hybridStore,
          "hybrid",
          input.scopeId,
          input.calls,
          splitDepth,
          maxPerSession,
        );
        const name = `hybrid_session_breadth_${String(maxPerSession)}_depth_${String(splitDepth)}`;
        addArm(arms, name, ids, groups, recordsById, {
          description: `Hybrid replay capped at ${String(maxPerSession)} candidate(s) per session.`,
        });
        armOrder.push(name);
      }

      const counterfactualArms = {};
      const queryDates = queryDateLiterals(input.calls);
      if (queryDates.length > 0) {
        const datedCalls = queryDates.flatMap((date) => input.calls.map((call) => ({
          ...call,
          filters: {
            ...call.filters,
            after: `${date}T00:00:00`,
            before: `${date}T23:59:59`,
          },
        })));
        for (const backend of ["hybrid", "lexical"]) {
          const ids = await runBackendCalls(
            hybridStore,
            backend,
            input.scopeId,
            datedCalls,
            20,
          );
          addArm(
            counterfactualArms,
            `metadata_date_window_${backend}_20`,
            ids,
            groups,
            recordsById,
            {
              description: "Diagnostic counterfactual: route dates already present in Agent queries into deterministic record timestamp bounds, while preserving the same semantic queries and role filters.",
              counterfactual: true,
              date_literals_from_agent_queries: queryDates,
            },
          );
        }
      }

      const neighborArmNames = [];
      for (const anchorCount of options.anchorCounts) {
        const anchorIds = input.observedSearch.slice(0, anchorCount);
        for (const radius of options.neighborRadii) {
          const expanded = rawStore.read(
            input.scopeId,
            anchorIds,
            radius,
            radius,
          ).map((record) => record.memoryId);
          const name = `observed_anchor_${String(anchorCount)}_neighbor_${String(radius)}`;
          addArm(arms, name, [...input.observedSearch, ...expanded], groups, recordsById, {
            description: "Actual historical candidates plus deterministic same-session turn neighbors.",
            anchor_count: anchorIds.length,
            neighbor_radius: radius,
          });
          armOrder.push(name);
          neighborArmNames.push(name);
        }
      }
      const maximumAnchorCount = Math.max(...options.anchorCounts);
      const anchorIds = input.observedSearch.slice(0, maximumAnchorCount);
      const anchorTexts = anchorIds.map((memoryId) => recordsById.get(memoryId)?.content)
        .filter((content) => typeof content === "string" && content.length > 0);
      intermediate.push({
        ...input,
        recordsById,
        groups,
        arms,
        armOrder,
        depthResults,
        neighborArmNames,
        counterfactualArms,
        queryDates,
        anchorIds,
        anchorTexts,
      });
    }

    await embedder.add(intermediate.flatMap((row) => row.anchorTexts));

    const rows = [];
    const globalArmOrder = [];
    for (const row of intermediate) {
      const { arms, armOrder, groups, recordsById } = row;
      const secondaryNames = [];
      for (const backend of ["lexical", "hybrid"]) {
        const hits = row.anchorTexts.length === 0
          ? []
          : backend === "hybrid"
            ? await hybridStore.search(row.scopeId, {
                queries: row.anchorTexts,
                limit: options.secondaryLimit,
              })
            : hybridStore.searchLexical(row.scopeId, {
                queries: row.anchorTexts,
                limit: options.secondaryLimit,
              });
        const secondaryIds = hits.map((hit) => hit.record.memoryId)
          .filter((memoryId) => !row.anchorIds.includes(memoryId));
        const name = `observed_anchor_secondary_${backend}_${String(options.secondaryLimit)}`;
        addArm(arms, name, [...row.observedSearch, ...secondaryIds], groups, recordsById, {
          description: "Actual historical candidates plus one corpus search whose queries are the top candidate contents.",
          anchor_count: row.anchorIds.length,
          secondary_candidate_count: secondaryIds.length,
        });
        armOrder.push(name);
        secondaryNames.push(name);
      }

      const nonOracleNames = [...armOrder];
      const composedIds = orderedUnique(nonOracleNames.flatMap((name) =>
        arms[name].candidate_ids
      ));
      addArm(arms, "composed_nonoracle_union", composedIds, groups, recordsById, {
        description: "Union ceiling across every non-oracle arm; not budget matched.",
      });
      armOrder.push("composed_nonoracle_union");

      const maximumDepth = Math.max(...options.depths);
      const hybridDeep = row.depthResults.hybrid.get(maximumDepth) ?? [];
      const oracleHybrid = oracleCoverageOrder(
        hybridDeep,
        groups,
        options.secondaryLimit,
      );
      arms.oracle_rerank_hybrid_deep = {
        ...coverage(oracleHybrid, groups, recordsById),
        uses_gold_during_retrieval: true,
        source_pool_candidate_count: orderedUnique(hybridDeep).length,
        description: "Gold-aware top-k ordering of the deepest hybrid pool; diagnostic upper bound only.",
      };
      armOrder.push("oracle_rerank_hybrid_deep");
      const oracleComposed = oracleCoverageOrder(
        composedIds,
        groups,
        options.secondaryLimit,
      );
      arms.oracle_rerank_composed = {
        ...coverage(oracleComposed, groups, recordsById),
        uses_gold_during_retrieval: true,
        source_pool_candidate_count: composedIds.length,
        description: "Gold-aware top-k ordering of the non-oracle union; diagnostic upper bound only.",
      };
      armOrder.push("oracle_rerank_composed");

      const corpusFirstNames = armOrder.filter((name) =>
        /^(?:hybrid|lexical)_(?:depth|split|session)/u.test(name)
      );
      const candidateDependentNames = [
        ...row.neighborArmNames,
        ...secondaryNames,
      ];
      const corpusFirstFull = corpusFirstNames.some((name) => arms[name].gold_all);
      const candidateDependentFull = candidateDependentNames.some((name) =>
        arms[name].gold_all
      );
      const recoveryClass = arms.observed_retrieval.gold_all
        ? "already_observed"
        : corpusFirstFull
          ? "corpus_first_recoverable"
          : candidateDependentFull
            ? "candidate_dependent_only"
            : arms.composed_nonoracle_union.gold_all
              ? "union_only"
              : "not_recovered";
      const firstFullRecovery = armOrder.find((name) => arms[name].gold_all) ?? null;
      rows.push({
        benchmark_query_id: row.target.benchmark_query_id,
        question_type: row.target.question_type,
        question: row.artifactRow.query,
        original_stage: row.target.stage,
        scope_id: row.scopeId,
        original_search_calls: row.calls.length,
        original_query_count: new Set(row.calls.flatMap((call) => call.queries)).size,
        semantic_calls: row.calls,
        date_literals_from_agent_queries: row.queryDates,
        gold_source_groups: groups,
        fixed_anchor_ids: row.anchorIds,
        recovery_class: recoveryClass,
        first_full_recovery: firstFullRecovery,
        arm_order: armOrder,
        arms,
        counterfactual_arms: row.counterfactualArms,
      });
      for (const name of armOrder) {
        if (!globalArmOrder.includes(name)) globalArmOrder.push(name);
      }
    }

    const output = {
      schema_version: 1,
      protocol: "pimem-mab-lme-oracle-retrieval-ablation-v3",
      gold_policy: {
        normal_arms: "Gold memory IDs score completed candidate pools only.",
        oracle_rerank_arms: "Gold memory IDs explicitly determine ordering; these are upper bounds, not deployable methods.",
      },
      inputs: {
        diagnostic: options.diagnostic,
        artifact: options.artifact,
        audit: options.audit,
        sqlite: options.sqlite,
      },
      parameters: {
        target_stages: options.targetStages,
        depths: options.depths,
        anchor_counts: options.anchorCounts,
        neighbor_radii: options.neighborRadii,
        secondary_limit: options.secondaryLimit,
      },
      embedding: {
        profile_id: embedder.profileId,
        model: embedder.model,
        dimensions: embedder.dimensions,
        cached_query_count: embedder.vectors.size,
        provider_metrics: baseEmbedder.snapshotMetrics(),
      },
      arm_order: globalArmOrder,
      summary: summarize(rows, globalArmOrder),
      rows,
    };
    await atomicJson(options.output, output);
    console.log(JSON.stringify(output.summary, null, 2));
  } finally {
    rawStore.close();
    await rm(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await main();
}
