import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestMemorySessions } from "../src/ingest.js";
import { MemoryStore } from "../src/store.js";
import type { MemorySessionInput } from "../src/types.js";

const temporaryPaths: string[] = [];

async function temporaryStore(): Promise<{
  root: string;
  store: MemoryStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi-mem-test-"));
  temporaryPaths.push(root);
  return {
    root,
    store: await MemoryStore.create(join(root, "memory.sqlite")),
  };
}

function sessions(content = "I adopted a cat named Miso."): MemorySessionInput[] {
  return [
    {
      scopeId: "scope-1",
      sessionId: "session-1",
      timestamp: "2024-01-02T03:04:00",
      metadata: { sourceSessionId: "session_1" },
      turns: [
        {
          id: "m-000000000000000000000001",
          role: "user",
          content,
          metadata: { sourceDiaId: "S1:1" },
        },
        {
          id: "m-000000000000000000000002",
          role: "assistant",
          content: "Miso sounds lovely.",
        },
      ],
    },
  ];
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("deterministic ingest and source store", () => {
  it("indexes exact source text and exports a bash-visible corpus", async () => {
    const { root, store } = await temporaryStore();
    try {
      const [result] = await ingestMemorySessions(store, sessions(), {
        exportRoot: join(root, "sanitized"),
      });
      expect(result).toMatchObject({
        scopeId: "scope-1",
        status: "inserted",
        memoryCount: 2,
      });

      const hits = store.search("scope-1", {
        queries: ["cat Miso"],
        limit: 5,
      });
      expect(hits[0]?.record.content).toBe("I adopted a cat named Miso.");
      const assistantHits = store.search("scope-1", {
        queries: ["Miso"],
        roles: ["assistant"],
        limit: 5,
      });
      expect(assistantHits.map((hit) => hit.record.content)).toEqual([
        "Miso sounds lovely.",
      ]);

      const read = store.read(
        "scope-1",
        ["m-000000000000000000000001"],
        0,
        1,
      );
      expect(read.map((record) => record.memoryId)).toEqual([
        "m-000000000000000000000001",
        "m-000000000000000000000002",
      ]);

      const memoryJsonl = await readFile(
        join(result?.exportPath ?? "", "memory.jsonl"),
        "utf8",
      );
      expect(memoryJsonl).toContain("I adopted a cat named Miso.");
      expect(memoryJsonl).toContain("m-000000000000000000000001");
    } finally {
      store.close();
    }
  });

  it("makes identical re-ingest a no-op and rejects source mutation", async () => {
    const { store } = await temporaryStore();
    try {
      const first = await ingestMemorySessions(store, sessions());
      const second = await ingestMemorySessions(store, sessions());
      expect(first[0]?.status).toBe("inserted");
      expect(second[0]?.status).toBe("unchanged");

      await expect(
        ingestMemorySessions(store, sessions("Changed source text.")),
      ).rejects.toThrow(/immutable memory scope/iu);
      expect(
        store.getRecords("scope-1", ["m-000000000000000000000001"])[0]
          ?.content,
      ).toBe("I adopted a cat named Miso.");
    } finally {
      store.close();
    }
  });

  it("rejects benchmark labels hidden in metadata", async () => {
    const { store } = await temporaryStore();
    const unsafe = sessions();
    unsafe[0]!.turns[0]!.metadata = {
      answer: "must never be indexed",
    };
    try {
      await expect(ingestMemorySessions(store, unsafe)).rejects.toThrow(
        /forbidden benchmark field/u,
      );
    } finally {
      store.close();
    }
  });

  it("preserves source-addressable empty turns", async () => {
    const { store } = await temporaryStore();
    const input = sessions("");
    try {
      await ingestMemorySessions(store, input);
      expect(
        store.getRecords("scope-1", ["m-000000000000000000000001"])[0]
          ?.content,
      ).toBe("");
    } finally {
      store.close();
    }
  });

  it("expands timeline and aggregate evidence from versioned database facts", async () => {
    const { store } = await temporaryStore();
    const input: MemorySessionInput[] = [
      {
        scopeId: "scope-1",
        sessionId: "session-target-date",
        timestamp: "2024-01-10T09:00:00",
        turns: [{
          id: "m-100000000000000000000001",
          role: "user",
          content: "I bought a smoker for the kitchen.",
        }],
      },
      {
        scopeId: "scope-1",
        sessionId: "session-market-one",
        timestamp: "2024-01-20T09:00:00",
        turns: [{
          id: "m-100000000000000000000002",
          role: "user",
          content: "At the market I earned a total of $120 from sales.",
        }],
      },
      {
        scopeId: "scope-1",
        sessionId: "session-market-two",
        timestamp: "2024-01-21T09:00:00",
        turns: [
          {
            id: "m-100000000000000000000003",
            role: "user",
            content: "At the market I sold 20 plants for $7.5 each.",
          },
          {
            id: "m-100000000000000000000004",
            role: "user",
            content: "Offer 10 loyalty points for every $50 spent.",
          },
        ],
      },
    ];
    try {
      await ingestMemorySessions(store, input);
      const seed = store.search("scope-1", {
        queries: ["market sales"],
        limit: 1,
      });
      const timeline = store.expandEvidenceOperator(
        "scope-1",
        { queries: ["kitchen appliance"], limit: 1 },
        {
          operator: "timeline",
          question: "What did I buy 10 days ago?",
          questionDate: "2024/01/20 (Sat) 12:00",
          targetDates: ["2024-01-10"],
          maxCandidates: 20,
        },
        seed,
      );
      expect(timeline.map((hit) => hit.record.memoryId)).toContain(
        "m-100000000000000000000001",
      );
      expect(timeline[0]?.retriever).toBe("pimem-timeline-db");
      expect(timeline[0]?.record.memoryId).toBe("m-100000000000000000000001");

      const aggregate = store.expandEvidenceOperator(
        "scope-1",
        { queries: ["market sales"], limit: 1 },
        {
          operator: "aggregate",
          question: "What was the total from all market sales?",
          targetDates: [],
          maxCandidates: 20,
        },
        seed,
      );
      expect(aggregate.map((hit) => hit.record.memoryId)).toEqual(
        expect.arrayContaining([
          "m-100000000000000000000002",
          "m-100000000000000000000003",
        ]),
      );
      expect(aggregate.map((hit) => hit.record.memoryId)).not.toContain(
        "m-100000000000000000000004",
      );
      expect(aggregate.every((hit) => hit.retriever === "pimem-aggregate-db"))
        .toBe(true);

      const firstStatus = store.ensureEvidenceFactIndex("scope-1");
      const secondStatus = store.ensureEvidenceFactIndex("scope-1");
      expect(firstStatus).toEqual(secondStatus);
      expect(firstStatus).toMatchObject({
        indexedMemories: 4,
        numericFacts: 3,
        temporalFacts: 4,
      });
    } finally {
      store.close();
    }
  });
});
