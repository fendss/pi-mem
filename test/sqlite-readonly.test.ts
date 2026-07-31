import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestMemorySessions } from "../src/ingest.js";
import { MemoryStore } from "../src/store.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("read-only SQLite retrieval connections", () => {
  it("serve FTS/read/fact operations while rejecting every write", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-mem-sqlite-reader-"));
    temporaryPaths.push(root);
    const path = join(root, "memory.sqlite");
    const writer = await MemoryStore.create(path);
    await ingestMemorySessions(writer, [{
      scopeId: "scope-a",
      sessionId: "session-a",
      timestamp: "2024-01-01T00:00:00.000Z",
      turns: [{
        id: "memory-a",
        role: "user",
        content: "I completed 7 tasks yesterday",
      }],
    }]);
    writer.ensureEvidenceFactIndex("scope-a");
    writer.close();

    const reader = await MemoryStore.create(path, { readOnly: true });
    try {
      const lexical = reader.search("scope-a", {
        queries: ["completed tasks"],
        limit: 10,
      });
      expect(lexical.map((hit) => hit.record.memoryId)).toEqual(["memory-a"]);
      expect(reader.read("scope-a", ["memory-a"])).toHaveLength(1);
      expect(reader.expandEvidenceOperator(
        "scope-a",
        { queries: ["2024-01-01 tasks"], limit: 10 },
        { operator: "temporal", maxCandidates: 10 },
        lexical,
      )).toHaveLength(1);
      expect(() => reader.appendMemoryRequest({
        requestId: "forbidden",
        requestHash: "hash",
        scopeId: "scope-a",
        sourceSessionId: "forbidden",
        messages: [{ role: "user", content: "must not be written" }],
      })).toThrow(/readonly|read-only/iu);
    } finally {
      reader.close();
    }
  });
});
