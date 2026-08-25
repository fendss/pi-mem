import { Type } from "@earendil-works/pi-ai";

export function createSearchParameters(operatorIds: readonly string[]) {
  if (operatorIds.length === 0) {
    throw new Error("Search tool requires at least one registered operator");
  }
  return Type.Object({
    operator: Type.Optional(Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z][a-z0-9._-]{0,63}$",
      description:
        `Agent-selected operator. Initially available: ${operatorIds.join(", ")}. ` +
        "A successfully defined run-local operator is also valid. Defaults to the registry default.",
    })),
    queries: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 8,
      description: "Focused query variants or separate evidence needs.",
    }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  });
}

export type SearchParametersSchema = ReturnType<typeof createSearchParameters>;

export const DefineOperatorParameters = Type.Object({
  id: Type.String({
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-z][a-z0-9._-]{0,63}$",
    description: "Short run-local operator ID used by a later search call.",
  }),
  summary: Type.String({ minLength: 1, maxLength: 240 }),
  sources: Type.Array(
    Type.Object({
      operator: Type.String({
        minLength: 1,
        maxLength: 64,
        pattern: "^[a-z][a-z0-9._-]{0,63}$",
      }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    {
      minItems: 1,
      maxItems: 4,
      description: "Existing operators to run with the later search query.",
    },
  ),
  combine: Type.Optional(
    Type.Union([Type.Literal("union"), Type.Literal("rrf")]),
  ),
}, {
  description:
    "Define one run-local search operator by composing existing operators. " +
    "One source is an alias; multiple sources default to RRF fusion.",
});

export const ReadParameters = Type.Object({
  candidateRefs: Type.Array(Type.Integer({ minimum: 0 }), {
    minItems: 1,
    maxItems: 100,
    description:
      "Stable candidate numbers returned by search or bash_ro. The harness resolves candidate numbers to exact internal memory IDs.",
  }),
  contextBefore: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  contextAfter: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
}, {
  description:
    "Read immutable candidate memories and optional bounded neighboring context. Oversized memories are returned as exact, query-focused excerpts bound to the full source hash.",
});

export const FinishParameters = Type.Object({
  status: Type.Union([
    Type.Literal("sufficient"),
    Type.Literal("insufficient"),
  ], {
    description:
      "Use sufficient only when every independent evidence need is represented by cited raw memory.",
  }),
  citations: Type.Array(
    Type.Object({
      candidateRef: Type.Integer({ minimum: 0 }),
      supports: Type.String({
        minLength: 1,
        description:
          "One atomic fact stated by this memory only; do not combine sources, calculate, or infer here.",
      }),
    }),
    {
      maxItems: 32,
      description:
        "Source citations covering every independent fact in the evidence package.",
    },
  ),
  evidenceSummary: Type.String({
    minLength: 1,
    description:
      "Lossless compact ledger of the cited facts. Keep distinct items, sessions, and updates separate and add no unsupported conclusion.",
  }),
  count: Type.Optional(Type.Integer({
    minimum: 0,
    description:
      "Optional source-grounded aggregate count. Omit for non-count evidence.",
  })),
  inventory: Type.Optional(
    Type.Array(
      Type.Object({
        item: Type.String({
          minLength: 1,
          description: "One distinct, explicitly supported inventory item.",
        }),
        candidateRefs: Type.Array(Type.Integer({ minimum: 0 }), {
          minItems: 1,
          description:
            "Sources for this item. Every referenced candidate must also appear in citations.",
        }),
      }),
      {
        description:
          "Optional evidence ledger for an explicitly enumerated list. Do not fabricate one row per unnamed member of an aggregate count.",
      },
    ),
  ),
});

export const BashRoParameters = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 4096 }),
});
