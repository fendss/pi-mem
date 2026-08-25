import type {
  SearchOperatorExecutionContext,
  SearchOperatorInput,
  SearchOperatorOutput,
} from "../model/search-operator.js";
import type { SearchOperatorCatalog } from "../ports/operator-catalog.js";

export interface ExecutedSearchOperator extends SearchOperatorOutput {
  operator: string;
  operatorVersion: string;
}

export async function executeSearchOperator(
  registry: SearchOperatorCatalog,
  operatorId: string,
  context: SearchOperatorExecutionContext,
  input: SearchOperatorInput,
): Promise<ExecutedSearchOperator> {
  const operator = registry.get(operatorId);
  const output = await operator.execute(context, input);
  for (const hit of output.hits) {
    if (hit.record.scopeId !== context.scopeId) {
      throw new Error(
        `Search operator ${operator.id} returned memory outside scope ${context.scopeId}`,
      );
    }
  }
  return {
    ...output,
    operator: operator.id,
    operatorVersion: operator.version,
  };
}
