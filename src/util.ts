import { createHash, randomUUID } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableMemoryId(
  scopeId: string,
  sessionId: string,
  turnIndex: number,
  sourceId?: string,
): string {
  const turnPart =
    sourceId?.trim() || `t${String(turnIndex).padStart(4, "0")}`;
  return `m-${sha256(`${scopeId}\0${sessionId}\0${turnPart}`).slice(0, 24)}`;
}

export function compactPreview(text: string, maxLength = 280): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Keeps both setup and the sentence-final episodic fact in search previews. */
export function episodicPreview(text: string, maxLength = 360): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxLength) return compact;
  const separator = " … ";
  const available = Math.max(0, maxLength - separator.length);
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${compact.slice(0, headLength)}${separator}${compact.slice(-tailLength)}`;
}

export function safePathSegment(value: string): string {
  const readable = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return `${readable || "scope"}-${sha256(value).slice(0, 12)}`;
}

export function newRunId(): string {
  return randomUUID();
}

export function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty`);
  }
  return normalized;
}
