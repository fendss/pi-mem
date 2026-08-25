import { describe, expect, it } from "vitest";
import {
  MemoryArenaPublicApplication,
  type MemoryArenaPublicBackend,
} from "../src/entrypoints/memoryarena-public-api/application.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("MemoryArena Public per-user execution", () => {
  it("serializes one user while allowing a different user to run", async () => {
    const firstRelease = deferred();
    const started: string[] = [];
    let calls = 0;
    const backend: MemoryArenaPublicBackend = {
      initialize: async (input) => ({ ...input, generation: 1 }),
      wrap: async (input) => ({ userId: input.userId, prompt: input.question }),
      add: async (input) => {
        calls += 1;
        const call = calls;
        started.push(`${input.userId}-${call}`);
        if (call === 1) await firstRelease.promise;
        return { userId: input.userId, response: null };
      },
    };
    const application = new MemoryArenaPublicApplication(backend);
    const first = application.add({
      userId: "same",
      memorySystemName: "pimem",
      chunk: "one",
    });
    await Promise.resolve();
    const secondSame = application.add({
      userId: "same",
      memorySystemName: "pimem",
      chunk: "two",
    });
    const other = application.add({
      userId: "other",
      memorySystemName: "pimem",
      chunk: "parallel",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(["same-1", "other-2"]);
    await other;
    firstRelease.resolve();
    await Promise.all([first, secondSame]);
    expect(started).toEqual(["same-1", "other-2", "same-3"]);
  });
});
