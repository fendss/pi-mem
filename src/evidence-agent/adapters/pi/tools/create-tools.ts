import { createBashRoTool } from "./bash-tool.js";
import type { CreatePiMemToolsOptions, PiMemTools } from "./contracts.js";
import { createFinishTool } from "./finish-tool.js";
import { createDefineOperatorTool } from "./define-operator-tool.js";
import { createReadTool } from "./read-tool.js";
import { createSearchTool } from "./search-tool.js";

export function createPiMemTools(
  options: CreatePiMemToolsOptions,
): PiMemTools {
  if (options.scopeId !== options.ledger.scopeId) {
    throw new Error(
      `Tool scope ${options.scopeId} does not match ledger scope ${options.ledger.scopeId}`,
    );
  }
  const search = createSearchTool(options);
  const defineOperator =
    options.operatorDefinitions === undefined ||
    options.operatorDefinitions.remainingDefinitions() === 0
    ? undefined
    : createDefineOperatorTool({
        ...options,
        operatorDefinitions: options.operatorDefinitions,
      });
  const read = createReadTool(options);
  const bashRo =
    options.bashRo === undefined
      ? undefined
      : createBashRoTool({
          ...options,
          bashRo: options.bashRo,
        });
  const finish = createFinishTool(options);
  const all = [
    search,
    ...(defineOperator === undefined ? [] : [defineOperator]),
    read,
    ...(bashRo === undefined ? [] : [bashRo]),
    finish,
  ];
  return {
    search,
    ...(defineOperator === undefined ? {} : { defineOperator }),
    read,
    ...(bashRo === undefined ? {} : { bashRo }),
    finish,
    all,
  };
}
