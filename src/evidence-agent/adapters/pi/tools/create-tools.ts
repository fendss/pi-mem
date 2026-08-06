import { createBashRoTool } from "./bash-tool.js";
import type { CreatePiMemToolsOptions, PiMemTools } from "./contracts.js";
import { createFinishTool } from "./finish-tool.js";
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
  const read = createReadTool(options);
  const bashRo =
    options.bashRo === undefined
      ? undefined
      : createBashRoTool({
          ...options,
          bashRo: options.bashRo,
        });
  const finish = createFinishTool(options);
  return bashRo === undefined
    ? { search, read, finish, all: [search, read, finish] }
    : {
        search,
        read,
        bashRo,
        finish,
        all: [search, read, bashRo, finish],
      };
}
