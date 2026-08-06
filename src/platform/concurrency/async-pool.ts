export interface AsyncPoolContext {
  slot: number;
  index: number;
}

/** Runs at most one item per slot and refills a slot as soon as it settles. */
export async function runAsyncPool<T, R>(
  items: readonly T[],
  slots: number,
  worker: (item: T, context: AsyncPoolContext) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(slots) || slots <= 0) {
    throw new Error("Async pool slots must be a positive integer");
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;
  const consume = async (slot: number): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, { slot, index });
    }
  };

  const workerCount = Math.min(slots, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, (_unused, index) => consume(index + 1)),
  );
  return results;
}
