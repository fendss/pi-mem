import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseAddRequest,
  parseSearchRequest,
  renderRetrievalQuestion,
} from "../src/entrypoints/ldbd-api/contracts.js";
import { LdbdInboxStore } from "../src/entrypoints/ldbd-api/inbox-store.js";
import { LdbdApiService } from "../src/entrypoints/ldbd-api/service.js";

const temporaryDirectories: string[] = [];

async function inbox(): Promise<{ directory: string; store: LdbdInboxStore }> {
  const directory = await mkdtemp(join(tmpdir(), "pimem-ldbd-api-"));
  temporaryDirectories.push(directory);
  return { directory, store: new LdbdInboxStore(join(directory, "inbox.sqlite")) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LDBD API contracts", () => {
  it("accepts the synchronous Add contract and strips unrelated fields", () => {
    expect(parseAddRequest({
      request_id: "request-1",
      user_id: "user-1",
      session_id: "session-1",
      messages: [{ role: "user", content: "hello", timestamp: 1_704_067_200_000 }],
      answer_fixed: "must-not-cross-the-boundary",
    })).toEqual({
      requestId: "request-1",
      userId: "user-1",
      sessionId: "session-1",
      messages: [{ role: "user", content: "hello", timestamp: 1_704_067_200_000 }],
    });
  });

  it("rejects malformed probes without writing", () => {
    expect(() => parseAddRequest({})).toThrow("messages must be a non-empty array");
    expect(() => parseSearchRequest({})).toThrow("top_k must be an integer");
  });

  it("adds benchmark options only to the retrieval question", () => {
    const request = parseSearchRequest({
      query: "Which preference applies?",
      user_id: "user-1",
      top_k: 100,
      options: ["first", "second"],
    });
    expect(renderRetrievalQuestion(request)).toContain("A. first\nB. second");
  });
});

describe("LDBD API persistence and service", () => {
  it("makes Add idempotent and rejects request ID conflicts", async () => {
    const fixture = await inbox();
    try {
      const request = parseAddRequest({
        request_id: "request-1",
        user_id: "user-1",
        session_id: "session-1",
        messages: [{ role: "assistant", content: "stored memory" }],
      });
      expect(fixture.store.put(request)).toBe("inserted");
      expect(fixture.store.put(request)).toBe("unchanged");
      expect(fixture.store.listForUser("user-1")).toHaveLength(1);
      expect(() => fixture.store.put({
        ...request,
        messages: [{ role: "assistant", content: "different memory" }],
      })).toThrow("request_id already exists with different content");
    } finally {
      fixture.store.close();
    }
  });

  it("returns the exact LDBD response envelopes", async () => {
    const fixture = await inbox();
    const search = vi.fn(async () => [{ id: "memory-1", content: "evidence", score: 1 }]);
    try {
      const service = new LdbdApiService(fixture.store, { search });
      expect(service.add({
        request_id: "request-1",
        user_id: "user-1",
        session_id: "session-1",
        messages: [{ role: "user", content: "memory" }],
      })).toMatchObject({
        success: true,
        request_id: "request-1",
        user_id: "user-1",
        session_id: "session-1",
      });
      await expect(service.search({ query: "question", user_id: "user-1", top_k: 100 }))
        .resolves.toEqual({ data: [{ id: "memory-1", content: "evidence", score: 1 }] });
      expect(search).toHaveBeenCalledOnce();
    } finally {
      fixture.store.close();
    }
  });
});
