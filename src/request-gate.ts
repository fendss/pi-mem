export class AsyncKeyedRequestGate {
  private readonly states = new Map<string, {
    tail: Promise<void>;
    pending: number;
  }>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (key.length === 0) throw new Error("Request gate key must not be empty");
    let state = this.states.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), pending: 0 };
      this.states.set(key, state);
    }
    state.pending += 1;
    const previous = state.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.tail = previous.then(() => current, () => current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      state.pending -= 1;
      if (state.pending === 0 && this.states.get(key) === state) {
        this.states.delete(key);
      }
    }
  }
}

export class AsyncRequestGate {
  private readonly maximumConcurrent: number;
  private readonly minimumStartIntervalMs: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private nextStartMs = 0;

  constructor(maximumConcurrent: number, requestsPerSecond: number) {
    if (!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent <= 0) {
      throw new Error("Request gate concurrency must be a positive integer");
    }
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
      throw new Error("Request gate rate must be positive and finite");
    }
    this.maximumConcurrent = maximumConcurrent;
    this.minimumStartIntervalMs = 1000 / requestsPerSecond;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      await this.pace();
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maximumConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }

  private async pace(): Promise<void> {
    const now = performance.now();
    const start = Math.max(now, this.nextStartMs);
    this.nextStartMs = start + this.minimumStartIntervalMs;
    const delayMs = start - now;
    if (delayMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}
