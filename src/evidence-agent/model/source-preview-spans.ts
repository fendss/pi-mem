import { mergeSpans, type SourceSpan } from "./source-evidence.js";
import type { RetrievalHit } from "../../retrieval/index.js";
import { queryCenteredEpisodicPreview } from "../../util.js";

/** Legacy adapters may return unbounded previews; store and display the same view. */
export function candidatePreview(hit: RetrievalHit): string {
  if (hit.passage !== undefined) return hit.passage.content;
  return hit.preview.length <= 360 ? hit.preview : queryCenteredEpisodicPreview(
    hit.preview, (hit.matchedQueries ?? [hit.query]).join(" "), 360,
  );
}

/** Recover only verbatim source fragments; whitespace compaction is reversible. */
export function sourcePreviewSpans(content: string, preview: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const fragment of new Set(preview.split(/…|\.{3}/u).map((part) => part.trim()))) {
    if (!fragment) continue;
    const pattern = fragment.split(/\s+/u)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s+");
    // Legacy previews lack hit coordinates. A deterministic exact occurrence
    // preserves their text, but does not claim to recover the retriever's
    // original occurrence. Passage candidates carry their own exact offsets.
    const match = new RegExp(pattern, "u").exec(content);
    if (match !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return mergeSpans(spans);
}
