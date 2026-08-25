import type { RetrievalHit, SearchRequest } from "../model/retrieval.js";
import type {
  CandidateSet,
  SearchOperatorCompositionStepTrace,
  SearchOperatorDefinition,
  SearchOperatorDefinitionCombineStep,
  SearchOperatorDefinitionSearchStep,
  SearchOperatorInput,
  SearchOperatorOutput,
} from "../model/search-operator.js";
import type { SearchOperator } from "../ports/search-operator.js";
import { sha256 } from "../../util.js";
import type { SearchOperatorCatalog } from "../ports/operator-catalog.js";

const IDENTIFIER = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_STEPS = 8;
const MAX_SEARCH_STEPS = 4;
const MAX_COMBINE_INPUTS = 4;
const RRF_K = 60;

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
  const usedOperators = new Set<string>();
  let searchSteps = 0;
  const steps = source.steps.map((sourceStep, index) => {
    const stepId = normalizedIdentifier(sourceStep.id, `step ${index + 1} ID`);
    if (seen.has(stepId)) {
      throw new Error(`Operator ${id} contains duplicate step ID ${stepId}`);
    }
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
      if (usedOperators.has(operator)) {
        throw new Error(`Operator ${id} repeats source operator ${operator}`);
      }
      catalog.get(operator);
      const limit = normalizedLimit(sourceStep.limit, `step ${stepId} limit`);
      const step: SearchOperatorDefinitionSearchStep = {
        id: stepId,
        kind: "search",
        operator,
        ...(limit === undefined ? {} : { limit }),
      };
      seen.add(stepId);
      usedOperators.add(operator);
      return step;
    }
    if (sourceStep.kind !== "combine") {
      throw new Error(`Operator ${id} step ${stepId} has an unsupported kind`);
    }
    if (
      sourceStep.inputs.length < 2 ||
      sourceStep.inputs.length > MAX_COMBINE_INPUTS
    ) {
      throw new Error(
        `Operator ${id} combine step ${stepId} must have between 2 and ${MAX_COMBINE_INPUTS} inputs`,
      );
    }
    const inputs = sourceStep.inputs.map((input, inputIndex) => {
      const normalized = normalizedIdentifier(
        input,
        `step ${stepId} input[${inputIndex}]`,
      );
      if (!seen.has(normalized)) {
        throw new Error(
          `Operator ${id} step ${stepId} references unavailable prior step ${normalized}`,
        );
      }
      return normalized;
    });
    if (new Set(inputs).size !== inputs.length) {
      throw new Error(
        `Operator ${id} combine step ${stepId} inputs must be distinct`,
      );
    }
    const method = sourceStep.method;
    if (method !== "union" && method !== "rrf") {
      throw new Error(
        `Operator ${id} step ${stepId} has an unsupported combine method`,
      );
    }
    const limit = normalizedLimit(sourceStep.limit, `step ${stepId} limit`);
    const step: SearchOperatorDefinitionCombineStep = {
      id: stepId,
      kind: "combine",
      inputs,
      method,
      ...(limit === undefined ? {} : { limit }),
    };
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

function unionCandidateSets(
  sets: readonly (readonly RetrievalHit[])[],
  limit: number,
): RetrievalHit[] {
  const seen = new Set<string>();
  const hits: RetrievalHit[] = [];
  for (const set of sets) {
    for (const hit of set) {
      if (seen.has(hit.record.memoryId)) continue;
      seen.add(hit.record.memoryId);
      hits.push(hit);
      if (hits.length === limit) return withRanks(hits, limit);
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

function requestFor(input: SearchOperatorInput): SearchRequest {
  return {
    queries: [...input.queries],
    limit: input.limit,
    order: "relevance",
    ...(input.maxPerSession === undefined
      ? {}
      : { maxPerSession: input.maxPerSession }),
  };
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
  const operator: SearchOperator = {
    id: definition.id,
    version: definition.version,
    guide: definition.guide,
    async execute(context, input) {
      const candidateSets = new Map<string, CandidateSet>();
      const trace: SearchOperatorCompositionStepTrace[] = [];
      for (const step of definition.steps) {
        if (step.kind === "search") {
          let child: SearchOperatorOutput;
          const childOperator = catalog.get(step.operator);
          try {
            child = await childOperator.execute(context, {
              ...input,
              limit: step.limit ?? input.limit,
            });
          } catch (error) {
            throw new Error(
              `Operator ${definition.id} failed at search step ${step.id} (${step.operator})`,
              { cause: error },
            );
          }
          const hits = withRanks(child.hits, step.limit ?? input.limit);
          candidateSets.set(step.id, { hits });
          trace.push({
            id: step.id,
            kind: "search",
            operator: step.operator,
            operatorVersion: childOperator.version,
            candidateCount: hits.length,
          });
          continue;
        }
        const inputs = step.inputs.map(
          (inputId) => candidateSets.get(inputId)!.hits,
        );
        const limit = step.limit ?? input.limit;
        const hits = step.method === "union"
          ? unionCandidateSets(inputs, limit)
          : rrfCandidateSets(inputs, limit);
        candidateSets.set(step.id, { hits });
        trace.push({
          id: step.id,
          kind: "combine",
          inputs: [...step.inputs],
          method: step.method,
          candidateCount: hits.length,
        });
      }
      return {
        request: requestFor(input),
        hits: [...candidateSets.get(definition.output)!.hits],
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
