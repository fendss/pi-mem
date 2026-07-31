import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
  "d9846fbb5cdcf8394c155e3e81534b485fa27bd3a559297a26fc1ba6bdc3eecf";

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
