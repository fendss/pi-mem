import { describe, expect, it } from "vitest";
import {
  AsyncKeyedRequestGate,
  AsyncRequestGate,
} from "../src/request-gate.js";

describe("AsyncKeyedRequestGate", () => {
  it("serializes each key while allowing different keys to overlap", async () => {
    const gate = new AsyncKeyedRequestGate();
    const activeByKey = new Map<string, number>();
    let totalActive = 0;
    let maximumTotal = 0;
    let maximumForKey = 0;
    await Promise.all(
      ["a", "a", "b", "b"].map((key) => gate.run(key, async () => {
        const active = (activeByKey.get(key) ?? 0) + 1;
        activeByKey.set(key, active);
        maximumForKey = Math.max(maximumForKey, active);
        totalActive += 1;
        maximumTotal = Math.max(maximumTotal, totalActive);
        await new Promise((resolve) => setTimeout(resolve, 10));
        totalActive -= 1;
        activeByKey.set(key, active - 1);
      })),
    );
    expect(maximumForKey).toBe(1);
    expect(maximumTotal).toBe(2);
  });

  it("releases a key after failure", async () => {
    const gate = new AsyncKeyedRequestGate();
    await expect(gate.run("key", async () => {
      throw new Error("expected failure");
    })).rejects.toThrow("expected failure");
    await expect(gate.run("key", async () => "ok")).resolves.toBe("ok");
  });

  it("rejects an empty key", async () => {
    const gate = new AsyncKeyedRequestGate();
    await expect(gate.run("", async () => "never")).rejects.toThrow(/key/u);
  });
});

describe("AsyncRequestGate", () => {
  it("bounds active operations", async () => {
    const gate = new AsyncRequestGate(3, 10_000);
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 18 }, () =>
        gate.run(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    expect(maximum).toBe(3);
  });

  it("paces operation starts globally", async () => {
    const gate = new AsyncRequestGate(8, 50);
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () =>
        gate.run(async () => {
          starts.push(performance.now());
        }),
      ),
    );
    const intervals = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(intervals.every((interval) => interval >= 14)).toBe(true);
  });

  it("releases a slot after an operation fails", async () => {
    const gate = new AsyncRequestGate(1, 10_000);
    await expect(
      gate.run(async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects invalid limits", () => {
    expect(() => new AsyncRequestGate(0, 1)).toThrow("positive integer");
    expect(() => new AsyncRequestGate(1, Number.NaN)).toThrow("positive and finite");
  });
});
