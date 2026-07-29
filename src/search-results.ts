import type { StoreSearchHit } from "./store.js";
import type { SearchRequest } from "./types.js";

function timestampValue(hit: StoreSearchHit): string {
  return hit.record.timestamp ?? "9999-99-99T99:99:99";
}

export function finalizeSearchHits(
  relevanceOrderedHits: readonly StoreSearchHit[],
  request: SearchRequest,
  limit: number,
): StoreSearchHit[] {
  const selected: StoreSearchHit[] = [];
  const sessionCounts = new Map<string, number>();
  for (const hit of relevanceOrderedHits) {
    if (selected.length >= limit) break;
    const count = sessionCounts.get(hit.record.sessionId) ?? 0;
    if (
      request.maxPerSession !== undefined &&
      count >= request.maxPerSession
    ) {
      continue;
    }
    selected.push(hit);
    sessionCounts.set(hit.record.sessionId, count + 1);
  }
  if (request.order === "chronological") {
    return selected.sort((left, right) => {
      const time = timestampValue(left).localeCompare(timestampValue(right));
      return time !== 0
        ? time
        : left.record.memoryId.localeCompare(right.record.memoryId);
    });
  }
  if (request.order === "reverse-chronological") {
    return selected.sort((left, right) => {
      const time = timestampValue(right).localeCompare(timestampValue(left));
      return time !== 0
        ? time
        : left.record.memoryId.localeCompare(right.record.memoryId);
    });
  }
  return selected;
}
