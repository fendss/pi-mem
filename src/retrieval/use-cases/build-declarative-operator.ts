import type {
  EvidenceOperatorResult,
  RetrievalHit,
  SearchRequest,
} from "../model/retrieval.js";
import type {
  CandidateSet,
  SearchOperatorCompositionStepTrace,
  SearchOperatorDefinition,
  SearchOperatorDefinitionStep,
  SearchOperatorInput,
  SearchOperatorOutput,
} from "../model/search-operator.js";
import type { SearchOperator } from "../ports/search-operator.js";
import { sha256 } from "../../util.js";
import type { SearchOperatorCatalog } from "../ports/operator-catalog.js";
import { buildAggregateOperatorResult } from "../operators/numeric-operator.js";
import { buildTimelineOperatorResult } from "../operators/temporal-operator.js";

const IDENTIFIER = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_STEPS = 12;
const MAX_SEARCH_STEPS = 4;
const MAX_COMBINE_INPUTS = 4;
const RRF_K = 60;
const MEMORY_ROLES = new Set(["user", "assistant", "system", "other"]);

interface NormalizedDefinition {
  definition: SearchOperatorDefinition;
  definitionHash: string;
}

function normalizedText(value: string, label: string, maxLength = 240): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} must contain at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizedIdentifier(value: string, label: string): string {
  const normalized = normalizedText(value, label);
  if (!IDENTIFIER.test(normalized)) {
    throw new Error(
      `Invalid ${label} ${JSON.stringify(normalized)}; expected ${String(IDENTIFIER)}`,
    );
  }
  return normalized;
}

function normalizedLimit(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${label} must be an integer between 1 and 100`);
  }
  return value;
}

function normalizeDefinition(
  catalog: SearchOperatorCatalog,
  source: SearchOperatorDefinition,
): NormalizedDefinition {
  const id = normalizedIdentifier(source.id, "operator ID");
  const version = normalizedText(source.version, `operator ${id} version`, 64);
  const summary = normalizedText(source.guide.summary, `operator ${id} summary`);
  if (!(["low", "medium", "high"] as const).includes(source.guide.cost)) {
    throw new Error(`Operator ${id} has an unsupported cost`);
  }
  const useWhen = source.guide.useWhen.map((value, index) =>
    normalizedText(value, `operator ${id} useWhen[${index}]`)
  );
  if (useWhen.length === 0 || useWhen.length > 3) {
    throw new Error(`Operator ${id} must declare between 1 and 3 useWhen rules`);
  }
  const avoidWhen = source.guide.avoidWhen?.map((value, index) =>
    normalizedText(value, `operator ${id} avoidWhen[${index}]`)
  );
  if (avoidWhen !== undefined && avoidWhen.length > 3) {
    throw new Error(`Operator ${id} may declare at most 3 avoidWhen rules`);
  }
  if (source.steps.length < 1 || source.steps.length > MAX_STEPS) {
    throw new Error(`Operator ${id} must contain between 1 and ${MAX_STEPS} steps`);
  }

  const seen = new Set<string>();
  let searchSteps = 0;
  const steps: SearchOperatorDefinitionStep[] = source.steps.map(
    (sourceStep, index) => {
    const stepId = normalizedIdentifier(sourceStep.id, `step ${index + 1} ID`);
    if (seen.has(stepId)) {
      throw new Error(`Operator ${id} contains duplicate step ID ${stepId}`);
    }
    const priorInput = (value: string, label = "input"): string => {
      const normalized = normalizedIdentifier(value, `step ${stepId} ${label}`);
      if (!seen.has(normalized)) {
        throw new Error(
          `Operator ${id} step ${stepId} references unavailable prior step ${normalized}`,
        );
      }
      return normalized;
    };
    let step: SearchOperatorDefinitionStep;
    if (sourceStep.kind === "search") {
      searchSteps += 1;
      if (searchSteps > MAX_SEARCH_STEPS) {
        throw new Error(
          `Operator ${id} may contain at most ${MAX_SEARCH_STEPS} search steps`,
        );
      }
      const operator = normalizedIdentifier(
        sourceStep.operator,
        `step ${stepId} operator`,
      );
      if (operator === id) {
        throw new Error(`Operator ${id} cannot call itself`);
      }
      catalog.get(operator);
      const limit = normalizedLimit(sourceStep.limit, `step ${stepId} limit`);
      const queries = sourceStep.queries?.map((query, queryIndex) =>
        normalizedText(query, `step ${stepId} queries[${queryIndex}]`, 512)
      );
      if (queries !== undefined && (queries.length < 1 || queries.length > 16)) {
        throw new Error(
          `Operator ${id} search step ${stepId} must contain between 1 and 16 queries`,
        );
      }
      step = {
        id: stepId,
        kind: "search",
        operator,
        ...(queries === undefined ? {} : { queries: [...new Set(queries)] }),
        ...(limit === undefined ? {} : { limit }),
      };
    } else if (sourceStep.kind === "combine") {
      if (
        sourceStep.inputs.length < 2 ||
        sourceStep.inputs.length > MAX_COMBINE_INPUTS
      ) {
        throw new Error(
          `Operator ${id} combine step ${stepId} must have between 2 and ${MAX_COMBINE_INPUTS} inputs`,
        );
      }
      const inputs = sourceStep.inputs.map((input, inputIndex) =>
        priorInput(input, `input[${inputIndex}]`)
      );
      if (new Set(inputs).size !== inputs.length) {
        throw new Error(
          `Operator ${id} combine step ${stepId} inputs must be distinct`,
        );
      }
      const method = sourceStep.method;
      if (
        method !== "union" && method !== "rrf" && method !== "intersection"
      ) {
        throw new Error(
          `Operator ${id} step ${stepId} has an unsupported combine method`,
        );
      }
      const limit = normalizedLimit(sourceStep.limit, `step ${stepId} limit`);
      step = {
        id: stepId,
        kind: "combine",
        inputs,
        method,
        ...(limit === undefined ? {} : { limit }),
      };
    } else if (sourceStep.kind === "filter") {
      const input = priorInput(sourceStep.input);
      const roles = [...new Set(sourceStep.roles)];
      if (
        roles.length === 0 ||
        roles.some((role) => !MEMORY_ROLES.has(role))
      ) {
        throw new Error(
          `Operator ${id} filter step ${stepId} must contain valid memory roles`,
        );
      }
      step = { id: stepId, kind: "filter", input, roles };
    } else if (sourceStep.kind === "sort") {
      const input = priorInput(sourceStep.input);
      if (
        sourceStep.order !== "relevance" &&
        sourceStep.order !== "chronological" &&
        sourceStep.order !== "reverse-chronological"
      ) {
        throw new Error(`Operator ${id} sort step ${stepId} has an invalid order`);
      }
      step = { id: stepId, kind: "sort", input, order: sourceStep.order };
    } else if (sourceStep.kind === "diversify") {
      const input = priorInput(sourceStep.input);
      if (sourceStep.by !== "session") {
        throw new Error(
          `Operator ${id} diversify step ${stepId} only supports session groups`,
        );
      }
      const maxPerGroup = normalizedLimit(
        sourceStep.maxPerGroup,
        `step ${stepId} maxPerGroup`,
      )!;
      step = {
        id: stepId,
        kind: "diversify",
        input,
        by: "session",
        maxPerGroup,
      };
    } else if (sourceStep.kind === "dedupe") {
      const input = priorInput(sourceStep.input);
      if (sourceStep.by !== "content") {
        throw new Error(
          `Operator ${id} dedupe step ${stepId} only supports content`,
        );
      }
      step = { id: stepId, kind: "dedupe", input, by: "content" };
    } else if (sourceStep.kind === "limit") {
      const input = priorInput(sourceStep.input);
      step = {
        id: stepId,
        kind: "limit",
        input,
        limit: normalizedLimit(sourceStep.limit, `step ${stepId} limit`)!,
      };
    } else if (sourceStep.kind === "annotate") {
      const input = priorInput(sourceStep.input);
      if (sourceStep.method !== "temporal" && sourceStep.method !== "numeric") {
        throw new Error(
          `Operator ${id} annotate step ${stepId} has an invalid method`,
        );
      }
      step = {
        id: stepId,
        kind: "annotate",
        input,
        method: sourceStep.method,
      };
    } else {
      throw new Error(`Operator ${id} step ${stepId} has an unsupported kind`);
    }
    seen.add(stepId);
    return step;
  });

  const output = normalizedIdentifier(source.output, `operator ${id} output`);
  if (!seen.has(output)) {
    throw new Error(`Operator ${id} output references unknown step ${output}`);
  }
  const byId = new Map(steps.map((step) => [step.id, step]));
  const reachable = new Set<string>();
  const visit = (stepId: string): void => {
    if (reachable.has(stepId)) return;
    reachable.add(stepId);
    const step = byId.get(stepId)!;
    if (step.kind === "combine") step.inputs.forEach(visit);
    else if (step.kind !== "search") visit(step.input);
  };
  visit(output);
  if (reachable.size !== steps.length) {
    const unused = steps
      .map((step) => step.id)
      .filter((stepId) => !reachable.has(stepId));
    throw new Error(`Operator ${id} contains unused steps: ${unused.join(", ")}`);
  }
  const definition: SearchOperatorDefinition = {
    id,
    version,
    guide: {
      summary,
      useWhen,
      ...(avoidWhen === undefined ? {} : { avoidWhen }),
      cost: source.guide.cost,
    },
    steps,
    output,
  };
  return {
    definition,
    definitionHash: sha256(JSON.stringify(definition)),
  };
}

function withRanks(hits: readonly RetrievalHit[], limit: number): RetrievalHit[] {
  return hits.slice(0, limit).map((hit, index) => ({
    ...hit,
    rank: index + 1,
  }));
}

function mergedMatchedQueries(
  left: RetrievalHit,
  right: RetrievalHit,
): string[] {
  return [...new Set([
    ...(left.matchedQueries ?? [left.query]),
    ...(right.matchedQueries ?? [right.query]),
  ])];
}

function mergedMetadataFilters(
  left: RetrievalHit,
  right: RetrievalHit,
): RetrievalHit["matchedMetadataFilters"] {
  const filters = [
    ...(left.matchedMetadataFilters ?? []),
    ...(right.matchedMetadataFilters ?? []),
  ];
  if (filters.length === 0) return undefined;
  return [...new Map(filters.map((filter) => [
    JSON.stringify([filter.source, filter.query, filter.after, filter.before]),
    filter,
  ])).values()];
}

function mergeHitProvenance(
  left: RetrievalHit,
  right: RetrievalHit,
): RetrievalHit {
  const merged: RetrievalHit = {
    ...left,
    matchedQueries: mergedMatchedQueries(left, right),
  };
  const filters = mergedMetadataFilters(left, right);
  if (filters !== undefined) merged.matchedMetadataFilters = filters;
  return merged;
}

function unionCandidateSets(
  sets: readonly (readonly RetrievalHit[])[],
  limit: number,
): RetrievalHit[] {
  const hits: RetrievalHit[] = [];
  const indexes = new Map<string, number>();
  const maxDepth = Math.max(...sets.map((set) => set.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const set of sets) {
      const hit = set[depth];
      if (hit === undefined) continue;
      const existingIndex = indexes.get(hit.record.memoryId);
      if (existingIndex !== undefined) {
        const existing = hits[existingIndex]!;
        hits[existingIndex] = mergeHitProvenance(existing, hit);
        continue;
      }
      if (hits.length >= limit) continue;
      indexes.set(hit.record.memoryId, hits.length);
      hits.push(hit);
    }
  }
  return withRanks(hits, limit);
}

function rrfCandidateSets(
  sets: readonly (readonly RetrievalHit[])[],
  limit: number,
): RetrievalHit[] {
  const fused = new Map<
    string,
    { hit: RetrievalHit; score: number; first: number }
  >();
  let first = 0;
  for (const set of sets) {
    set.forEach((hit, index) => {
      const key = hit.record.memoryId;
      const increment = 1 / (RRF_K + index + 1);
      const current = fused.get(key);
      if (current === undefined) {
        fused.set(key, { hit, score: increment, first });
        first += 1;
      } else {
        current.score += increment;
        current.hit = mergeHitProvenance(current.hit, hit);
      }
    });
  }
  return withRanks(
    [...fused.values()]
      .sort((left, right) =>
        right.score - left.score || left.first - right.first
      )
      .map(({ hit, score }) => ({ ...hit, score })),
    limit,
  );
}

function intersectCandidateSets(
  sets: readonly (readonly RetrievalHit[])[],
  limit: number,
): RetrievalHit[] {
  const required = sets.length;
  const counts = new Map<string, { hit: RetrievalHit; count: number }>();
  for (const set of sets) {
    const seen = new Set<string>();
    for (const hit of set) {
      const key = hit.record.memoryId;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key);
      if (current === undefined) counts.set(key, { hit, count: 1 });
      else {
        current.count += 1;
        current.hit = mergeHitProvenance(current.hit, hit);
      }
    }
  }
  return withRanks(
    [...counts.values()]
      .filter((entry) => entry.count === required)
      .map((entry) => entry.hit),
    limit,
  );
}

function sortCandidateSet(
  hits: readonly RetrievalHit[],
  order: "relevance" | "chronological" | "reverse-chronological",
): RetrievalHit[] {
  if (order === "relevance") return withRanks(hits, hits.length);
  const direction = order === "chronological" ? 1 : -1;
  return withRanks([...hits].sort((left, right) => {
    const leftTime = left.record.timestamp;
    const rightTime = right.record.timestamp;
    if (leftTime === undefined && rightTime !== undefined) return 1;
    if (leftTime !== undefined && rightTime === undefined) return -1;
    if (leftTime === undefined && rightTime === undefined) {
      return left.record.turnIndex - right.record.turnIndex ||
        left.record.memoryId.localeCompare(right.record.memoryId);
    }
    return direction * leftTime!.localeCompare(rightTime!) ||
      direction * (left.record.turnIndex - right.record.turnIndex) ||
      left.record.memoryId.localeCompare(right.record.memoryId);
  }), hits.length);
}

function diversifyBySession(
  hits: readonly RetrievalHit[],
  maxPerGroup: number,
): RetrievalHit[] {
  const groups = new Map<string, RetrievalHit[]>();
  for (const hit of hits) {
    const group = groups.get(hit.record.sessionId) ?? [];
    group.push(hit);
    groups.set(hit.record.sessionId, group);
  }
  const selected: RetrievalHit[] = [];
  for (let depth = 0; depth < maxPerGroup; depth += 1) {
    let progressed = false;
    for (const group of groups.values()) {
      const hit = group[depth];
      if (hit === undefined) continue;
      selected.push(hit);
      progressed = true;
    }
    if (!progressed) break;
  }
  return withRanks(selected, selected.length);
}

function dedupeByContent(hits: readonly RetrievalHit[]): RetrievalHit[] {
  const seen = new Set<string>();
  return withRanks(hits.filter((hit) => {
    const fingerprint = hit.record.content
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/gu, " ")
      .trim();
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  }), hits.length);
}

function annotateCandidateSet(
  method: "temporal" | "numeric",
  hits: readonly RetrievalHit[],
  question: string,
  questionDate: string | undefined,
): EvidenceOperatorResult {
  return method === "temporal"
    ? buildTimelineOperatorResult(hits, question, questionDate)
    : buildAggregateOperatorResult(hits);
}

function requestFor(input: SearchOperatorInput): SearchRequest {
  return {
    queries: [...input.queries],
    limit: input.limit,
    order: "relevance",
    ...(input.roles === undefined ? {} : { roles: [...input.roles] }),
    ...(input.maxPerSession === undefined
      ? {}
      : { maxPerSession: input.maxPerSession }),
  };
}

/**
 * A downstream session-diversify step must influence candidate generation,
 * not merely reorder an already truncated CandidateSet. Primitive retrievers
 * over-fetch when maxPerSession is present; pushing compatible role filters
 * down preserves the later transformation while exposing weaker sessions.
 */
interface SearchDiscoveryPolicy {
  maxPerSession: number;
  roles?: SearchOperatorInput["roles"];
}

function intersectRoles(
  left: SearchOperatorInput["roles"],
  right: SearchOperatorInput["roles"],
): SearchOperatorInput["roles"] {
  if (left === undefined) return right === undefined ? undefined : [...right];
  if (right === undefined) return [...left];
  const allowed = new Set(right);
  return left.filter((role) => allowed.has(role));
}

function sessionDiscoveryPolicies(
  steps: readonly SearchOperatorDefinitionStep[],
): Map<string, SearchDiscoveryPolicy> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const policies = new Map<string, SearchDiscoveryPolicy>();
  const visit = (
    stepId: string,
    maxPerSession: number,
    roles: SearchOperatorInput["roles"],
  ): void => {
    const step = byId.get(stepId)!;
    if (step.kind === "search") {
      const existing = policies.get(step.id);
      if (existing === undefined) {
        policies.set(step.id, {
          maxPerSession,
          ...(roles === undefined ? {} : { roles: [...roles] }),
        });
      } else {
        const mergedRoles = existing.roles === undefined || roles === undefined
          ? undefined
          : [...new Set([...existing.roles, ...roles])];
        policies.set(step.id, {
          maxPerSession: Math.min(existing.maxPerSession, maxPerSession),
          ...(mergedRoles === undefined ? {} : { roles: mergedRoles }),
        });
      }
      return;
    }
    if (step.kind === "combine") {
      step.inputs.forEach((input) => visit(input, maxPerSession, roles));
      return;
    }
    visit(
      step.input,
      maxPerSession,
      step.kind === "filter" ? intersectRoles(roles, step.roles) : roles,
    );
  };
  for (const step of steps) {
    if (step.kind !== "diversify") continue;
    visit(step.input, step.maxPerGroup, undefined);
  }
  return policies;
}

export interface BuiltDeclarativeSearchOperator {
  operator: SearchOperator;
  definition: SearchOperatorDefinition;
  definitionHash: string;
}

export function buildDeclarativeSearchOperator(
  catalog: SearchOperatorCatalog,
  source: SearchOperatorDefinition,
  definitionRevision: number,
): BuiltDeclarativeSearchOperator {
  const { definition, definitionHash } = normalizeDefinition(catalog, source);
  const discoveryPolicies = sessionDiscoveryPolicies(definition.steps);
  const operator: SearchOperator = {
    id: definition.id,
    version: definition.version,
    guide: definition.guide,
    async execute(context, input) {
      const candidateSets = new Map<string, CandidateSet & {
        operatorResult?: EvidenceOperatorResult;
      }>();
      const trace: SearchOperatorCompositionStepTrace[] = [];
      for (const step of definition.steps) {
        if (step.kind === "search") {
          let child: SearchOperatorOutput;
          const childOperator = catalog.get(step.operator);
          const discovery = discoveryPolicies.get(step.id);
          const maxPerSession = discovery === undefined
            ? input.maxPerSession
            : Math.min(
              input.maxPerSession ?? discovery.maxPerSession,
              discovery.maxPerSession,
            );
          const roles = intersectRoles(input.roles, discovery?.roles);
          try {
            child = await childOperator.execute(context, {
              ...input,
              ...(step.queries === undefined
                ? {}
                : { queries: [...step.queries] }),
              limit: step.limit ?? input.limit,
              ...(roles === undefined ? {} : { roles }),
              ...(maxPerSession === undefined ? {} : { maxPerSession }),
            });
          } catch (error) {
            throw new Error(
              `Operator ${definition.id} failed at search step ${step.id} (${step.operator})`,
              { cause: error },
            );
          }
          const hits = withRanks(child.hits, step.limit ?? input.limit);
          candidateSets.set(step.id, {
            hits,
            ...(child.operatorResult === undefined
              ? {}
              : { operatorResult: child.operatorResult }),
          });
          trace.push({
            id: step.id,
            kind: "search",
            operator: step.operator,
            operatorVersion: childOperator.version,
            queries: [...child.request.queries],
            ...(roles === undefined ? {} : { roles: [...roles] }),
            ...(maxPerSession === undefined ? {} : { maxPerSession }),
            candidateCount: hits.length,
          });
          continue;
        }
        if (step.kind === "combine") {
          const inputs = step.inputs.map(
            (inputId) => candidateSets.get(inputId)!.hits,
          );
          const limit = step.limit ?? input.limit;
          const hits = step.method === "union"
            ? unionCandidateSets(inputs, limit)
            : step.method === "rrf"
              ? rrfCandidateSets(inputs, limit)
              : intersectCandidateSets(inputs, limit);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "combine",
            inputs: [...step.inputs],
            method: step.method,
            candidateCount: hits.length,
          });
          continue;
        }
        const source = candidateSets.get(step.input)!;
        if (step.kind === "filter") {
          const roles = new Set(step.roles);
          const hits = withRanks(
            source.hits.filter((hit) => roles.has(hit.record.role)),
            source.hits.length,
          );
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "filter",
            input: step.input,
            roles: [...step.roles],
            candidateCount: hits.length,
          });
          continue;
        }
        if (step.kind === "sort") {
          const hits = sortCandidateSet(source.hits, step.order);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "sort",
            input: step.input,
            order: step.order,
            candidateCount: hits.length,
          });
          continue;
        }
        if (step.kind === "diversify") {
          const hits = diversifyBySession(source.hits, step.maxPerGroup);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "diversify",
            input: step.input,
            by: step.by,
            maxPerGroup: step.maxPerGroup,
            candidateCount: hits.length,
          });
          continue;
        }
        if (step.kind === "dedupe") {
          const hits = dedupeByContent(source.hits);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "dedupe",
            input: step.input,
            by: step.by,
            candidateCount: hits.length,
          });
          continue;
        }
        if (step.kind === "limit") {
          const hits = withRanks(source.hits, step.limit);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "limit",
            input: step.input,
            limit: step.limit,
            candidateCount: hits.length,
          });
          continue;
        }
        const operatorResult = annotateCandidateSet(
          step.method,
          source.hits,
          context.question ?? input.queries.join(" "),
          context.questionDate,
        );
        candidateSets.set(step.id, { hits: source.hits, operatorResult });
        trace.push({
          id: step.id,
          kind: "annotate",
          input: step.input,
          annotation: step.method,
          candidateCount: source.hits.length,
        });
      }
      const output = candidateSets.get(definition.output)!;
      return {
        request: requestFor(input),
        hits: [...output.hits],
        ...(output.operatorResult === undefined
          ? {}
          : { operatorResult: output.operatorResult }),
        composition: {
          definitionHash,
          definitionRevision,
          steps: trace,
        },
      };
    },
  };
  return { operator, definition, definitionHash };
}
