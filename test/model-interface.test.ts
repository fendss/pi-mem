import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReadOnlyBash } from "../src/bash-ro.js";
import { MemoryLedger } from "../src/ledger.js";
import {
  PIMEM_HARNESS_VERSION,
  PI_MEM_SYSTEM_PROMPT,
} from "../src/runtime.js";
import { PIMEM_RETRIEVAL_SKILL } from "../src/retrieval-skill.js";
import {
  createPiMemTools,
  type MemoryToolStore,
} from "../src/tools.js";

const VALIDATED_PRE_QDRANT_INTERFACE_HASH =
  "d361baf96f2e7056f975a9c60aa5f5e6205e6d1856c1ff2dc258a3435d64b0ca";

describe("Retrieval model interface", () => {
  it("is byte-equivalent to the validated pre-Qdrant 356-run interface", () => {
    const store: MemoryToolStore = {
      search: () => [],
      read: () => [],
    };
    const tools = createPiMemTools({
      store,
      scopeId: "scope",
      ledger: new MemoryLedger("scope"),
      bashRo: {
        runner: new ReadOnlyBash(),
        scopePath: "/scope",
        store: {
          findMentionedMemoryIds: () => [],
          getRecords: () => [],
        },
      },
    });
    const modelInterface = {
      harnessVersion: PIMEM_HARNESS_VERSION,
      systemPrompt: PI_MEM_SYSTEM_PROMPT,
      retrievalSkill: PIMEM_RETRIEVAL_SKILL,
      tools: tools.all.map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: JSON.parse(JSON.stringify(tool.parameters)) as unknown,
      })),
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(modelInterface))
      .digest("hex");

    expect(hash).toBe(VALIDATED_PRE_QDRANT_INTERFACE_HASH);
  });
});
