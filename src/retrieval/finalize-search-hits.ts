import type { RetrievalHit, SearchRequest } from "./model/search.js";

function timestampValue(hit: RetrievalHit): string {
  return hit.record.timestamp ?? "9999-99-99T99:99:99";
}

export function finalizeSearchHits(
  relevanceOrderedHits: readonly RetrievalHit[],
  request: SearchRequest,
  limit: number,
): RetrievalHit[] {
  const selected = request.maxPerSession === undefined
    ? relevanceOrderedHits.slice(0, limit)
    : selectSessionBreadth(
        relevanceOrderedHits,
        request.maxPerSession,
        limit,
      );
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

/**
 * Breadth-first admission only when the caller explicitly asks for a session
 * cap. Later rounds preserve useful depth within strong sessions; in
 * particular this does not collapse a conversation to one event unless the
 * caller chose maxPerSession=1.
 */
function selectSessionBreadth(
  relevanceOrderedHits: readonly RetrievalHit[],
  maxPerSession: number,
  limit: number,
): RetrievalHit[] {
  const sessions = new Map<string, RetrievalHit[]>();
  for (const hit of relevanceOrderedHits) {
    const session = sessions.get(hit.record.sessionId) ?? [];
    session.push(hit);
    sessions.set(hit.record.sessionId, session);
  }
  const selected: RetrievalHit[] = [];
  for (let depth = 0; depth < maxPerSession; depth += 1) {
    let progressed = false;
    for (const session of sessions.values()) {
      const hit = session[depth];
      if (hit === undefined) continue;
      selected.push(hit);
      progressed = true;
      if (selected.length >= limit) return selected;
    }
    if (!progressed) break;
  }
  return selected;
}
