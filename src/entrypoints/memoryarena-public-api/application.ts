import type {
  MemoryArenaAddInput,
  MemoryArenaAddResult,
  MemoryArenaInitializeInput,
  MemoryArenaInitializeResult,
  MemoryArenaWrapInput,
  MemoryArenaWrapResult,
} from "../../benchmark/memoryarena-public/index.js";
import {
  parseMemoryArenaAddRequest,
  parseMemoryArenaInitializeRequest,
  parseMemoryArenaWrapRequest,
} from "./contracts.js";

export interface MemoryArenaPublicBackend {
  initialize(
    input: MemoryArenaInitializeInput,
  ): Promise<MemoryArenaInitializeResult>;
  add(input: MemoryArenaAddInput): Promise<MemoryArenaAddResult>;
  wrap(input: MemoryArenaWrapInput): Promise<MemoryArenaWrapResult>;
}

class KeyedSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = predecessor.then(() => current);
    this.tails.set(key, tail);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/** Serializes one user's lifecycle while allowing independent users to overlap. */
export class MemoryArenaPublicApplication {
  private readonly serial = new KeyedSerialExecutor();

  constructor(private readonly backend: MemoryArenaPublicBackend) {}

  initialize(
    input: MemoryArenaInitializeInput,
  ): Promise<MemoryArenaInitializeResult> {
    return this.serial.run(input.userId, () => this.backend.initialize(input));
  }

  add(input: MemoryArenaAddInput): Promise<MemoryArenaAddResult> {
    return this.serial.run(input.userId, () => this.backend.add(input));
  }

  wrap(input: MemoryArenaWrapInput): Promise<MemoryArenaWrapResult> {
    return this.serial.run(input.userId, () => this.backend.wrap(input));
  }
}

export class MemoryArenaPublicApiService {
  constructor(private readonly application: MemoryArenaPublicApplication) {}

  async initialize(value: unknown): Promise<Record<string, unknown>> {
    const input = parseMemoryArenaInitializeRequest(value);
    const result = await this.application.initialize(input);
    return {
      status: "ok",
      user_id: result.userId,
      memory_system_name: result.memorySystemName,
    };
  }

  async add(value: unknown): Promise<Record<string, unknown>> {
    const input = parseMemoryArenaAddRequest(value);
    const result = await this.application.add(input);
    return {
      status: "ok",
      user_id: result.userId,
      response: result.response,
    };
  }

  async wrap(value: unknown): Promise<Record<string, unknown>> {
    const input = parseMemoryArenaWrapRequest(value);
    const result = await this.application.wrap(input);
    return {
      status: "ok",
      user_id: result.userId,
      prompt: result.prompt,
    };
  }
}
