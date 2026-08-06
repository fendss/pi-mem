import type { LdbdSearchItem } from "./pimem-runtime.js";
import { parseAddRequest, parseSearchRequest } from "./contracts.js";
import type { LdbdInboxStore } from "./inbox-store.js";

export interface LdbdSearchEngine {
  search(request: ReturnType<typeof parseSearchRequest>): Promise<LdbdSearchItem[]>;
}

export class LdbdApiService {
  constructor(
    private readonly inbox: LdbdInboxStore,
    private readonly searchEngine: LdbdSearchEngine,
  ) {}

  add(value: unknown): Record<string, unknown> {
    const request = parseAddRequest(value);
    const status = this.inbox.put(request);
    return {
      success: true,
      request_id: request.requestId,
      user_id: request.userId,
      session_id: request.sessionId,
      status,
    };
  }

  async search(value: unknown): Promise<{ data: LdbdSearchItem[] }> {
    const request = parseSearchRequest(value);
    return { data: await this.searchEngine.search(request) };
  }
}
