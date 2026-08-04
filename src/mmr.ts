import { tokenizeForPiMemHybrid } from "./ranking.js";

export interface MmrCandidate {
  id: string;
  relevance: number;
  text: string;
  vector?: ArrayLike<number>;
}

function normalizedVector(vector: ArrayLike<number> | undefined): Float32Array | undefined {
  if (vector === undefined) return undefined;
  if (vector.length === 0) {
    throw new Error("MMR vectors must be non-empty and finite");
  }
  let squaredNorm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index]!;
    if (!Number.isFinite(value)) {
      throw new Error("MMR vectors must be non-empty and finite");
    }
    squaredNorm += value * value;
  }
  if (squaredNorm === 0) return undefined;
  const norm = Math.sqrt(squaredNorm);
  return Float32Array.from(vector, (value) => value / norm);
}

function vectorCosine(
  left: Float32Array,
  right: Float32Array,
): number {
  if (left.length !== right.length) {
    throw new Error("MMR vectors must have the same dimensions");
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
  }
  return Math.min(1, Math.max(0, dot));
}

function tokenJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

/**
 * Deterministic MMR over a relevance-ordered candidate pool. Existing semantic
 * vectors are used when both candidates have one; token Jaccard is a bounded
 * fallback for sparse-only candidates. No model or benchmark labels are used.
 */
export function maximalMarginalRelevance(
  candidates: readonly MmrCandidate[],
  limit: number,
  lambda = 0.8,
): number[] {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("MMR limit must be a non-negative integer");
  }
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new Error("MMR lambda must be between 0 and 1");
  }
  if (candidates.length === 0 || limit === 0) return [];
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error("MMR candidates must have unique IDs");
  }
  for (const candidate of candidates) {
    if (!candidate.id || !Number.isFinite(candidate.relevance)) {
      throw new Error("MMR candidate IDs and relevance scores must be valid");
    }
  }

  const minimum = Math.min(...candidates.map((candidate) => candidate.relevance));
  const maximum = Math.max(...candidates.map((candidate) => candidate.relevance));
  const range = maximum - minimum;
  const relevance = candidates.map((candidate) =>
    range === 0 ? 1 : (candidate.relevance - minimum) / range
  );
  const vectors = candidates.map((candidate) => normalizedVector(candidate.vector));
  const tokenSets = candidates.map((candidate) =>
    new Set(tokenizeForPiMemHybrid(candidate.text))
  );
  const maximumSimilarity = candidates.map(() => 0);
  const selected: number[] = [];
  const selectedSet = new Set<number>();
  const target = Math.min(limit, candidates.length);

  while (selected.length < target) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      if (selectedSet.has(index)) continue;
      const score =
        lambda * relevance[index]! -
        (1 - lambda) * maximumSimilarity[index]!;
      if (
        score > bestScore ||
        (score === bestScore && bestIndex >= 0 &&
          candidates[index]!.id.localeCompare(candidates[bestIndex]!.id) < 0)
      ) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    selected.push(bestIndex);
    selectedSet.add(bestIndex);

    for (let index = 0; index < candidates.length; index += 1) {
      if (selectedSet.has(index)) continue;
      const leftVector = vectors[index];
      const rightVector = vectors[bestIndex];
      const similarity = leftVector !== undefined && rightVector !== undefined
        ? vectorCosine(leftVector, rightVector)
        : tokenJaccard(tokenSets[index]!, tokenSets[bestIndex]!);
      if (similarity > maximumSimilarity[index]!) {
        maximumSimilarity[index] = similarity;
      }
    }
  }
  return selected;
}
