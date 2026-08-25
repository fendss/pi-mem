import type {
  CreatePiMemToolsOptions,
  PiMemTools,
} from "./contracts.js";
import { DefineOperatorParameters } from "./schemas.js";

export function createDefineOperatorTool(
  options: CreatePiMemToolsOptions & {
    operatorDefinitions: NonNullable<CreatePiMemToolsOptions["operatorDefinitions"]>;
  },
): NonNullable<PiMemTools["defineOperator"]> {
  const initialSourceIds = options.operatorRegistry.list().map((entry) =>
    entry.id
  );
  const allowedSources = new Set(initialSourceIds);
  return {
    name: "define_operator",
    label: "Define search operator",
    description: [
      "Create one run-local search operator only when the existing catalog cannot express the needed recall pattern.",
      "List one to four existing operators as sources; multiple sources " +
      "default to RRF fusion. This tool cannot read memory or create evidence.",
      `Initial source operators: ${initialSourceIds.join(", ")}.`,
      `Remaining definition budget at run start: ${options.operatorDefinitions.remainingDefinitions()}.`,
    ].join(" "),
    parameters: DefineOperatorParameters,
    async execute(_toolCallId, params) {
      const sourceIds = params.sources.map((source) => source.operator);
      const unknownSources = sourceIds.filter((source) =>
        !allowedSources.has(source)
      );
      if (unknownSources.length > 0) {
        throw new Error(
          "Operator sources must come from the initial catalog; unknown: " +
          unknownSources.join(", "),
        );
      }
      if (new Set(sourceIds).size !== sourceIds.length) {
        throw new Error("Operator sources must be distinct");
      }
      const searchSteps = params.sources.map((source, index) => ({
        id: `source-${index + 1}`,
        kind: "search" as const,
        operator: source.operator,
        ...(source.limit === undefined ? {} : { limit: source.limit }),
      }));
      const multipleSources = searchSteps.length > 1;
      if (!multipleSources && params.combine !== undefined) {
        throw new Error("combine is only valid with multiple operator sources");
      }
      const definition = options.operatorDefinitions.define({
        id: params.id,
        version: "run-1",
        guide: {
          summary: params.summary,
          useWhen: [params.summary],
          cost: multipleSources ? "high" : "medium",
        },
        steps: multipleSources
          ? [
              ...searchSteps,
              {
                id: "combined",
                kind: "combine" as const,
                inputs: searchSteps.map((step) => step.id),
                method: params.combine ?? "rrf",
              },
            ]
          : searchSteps,
        output: multipleSources ? "combined" : "source-1",
      });
      const snapshot = options.operatorDefinitions.snapshots().find(
        (item) => item.revision === definition.catalog.revision,
      );
      if (snapshot === undefined) {
        throw new Error("Defined operator snapshot is unavailable");
      }
      const details = {
        kind: "define_operator",
        definition,
        snapshot,
      } as const;
      return {
        content: [{
          type: "text" as const,
          text:
            `Defined ${definition.id}@${definition.version} for this run ` +
            `(catalog revision ${definition.catalog.revision}). ` +
            `Use search with operator=${JSON.stringify(definition.id)}.`,
        }],
        details,
      };
    },
  };
}
