import { Type } from "@earendil-works/pi-ai";

export const SearchParameters = Type.Object({
  operator: Type.Optional(Type.Union([
    Type.Literal("hybrid"),
    Type.Literal("lexical"),
    Type.Literal("coverage"),
    Type.Literal("temporal"),
    Type.Literal("numeric"),
    Type.Literal("history"),
  ], {
    description: "Agent-selected retrieval operator. Defaults to hybrid. The harness never routes from question keywords.",
  })),
  queries: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 8,
    description: "Focused query variants or separate evidence needs.",
  }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const ReadParameters = Type.Object({
  candidateRefs: Type.Array(Type.Integer({ minimum: 0 }), {
    minItems: 1,
    maxItems: 100,
    description:
      "Stable candidate numbers returned by search or bash_ro. The harness resolves them to exact internal memory IDs. Zero is normalized to the first candidate for defensive compatibility with zero-based model output.",
  }),
  contextBefore: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
  contextAfter: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
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
