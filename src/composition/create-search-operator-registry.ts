import { builtInSearchOperators } from "../retrieval/adapters/operators/builtins.js";
import {
  SearchOperatorRegistry,
  type SearchOperator,
  type SearchOperatorStore,
} from "../retrieval/index.js";

/** Builds the allowlisted operator catalog once and freezes it for the run. */
export function createSearchOperatorRegistry(
  store: SearchOperatorStore,
  additionalOperators: readonly SearchOperator[] = [],
): SearchOperatorRegistry {
  const registry = new SearchOperatorRegistry("hybrid");
  for (const operator of [
    ...builtInSearchOperators(store),
    ...additionalOperators,
  ]) {
    registry.register(operator);
  }
  return registry.freeze();
}
