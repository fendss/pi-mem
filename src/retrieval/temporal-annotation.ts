const SOURCE_TIME =
  /^(\d{4})[-/](\d{2})[-/](\d{2})(?:\s*\([A-Za-z]{3}\))?[T ](\d{2}):(\d{2})(?::(\d{2}))?$/u;

export function parseSourceTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = SOURCE_TIME.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return timestamp;
}

function durationParts(milliseconds: number): string {
  const totalMinutes = Math.round(Math.abs(milliseconds) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (days === 0 && minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  return parts.join(" ") || "0 minutes";
}

export function temporalAnnotation(
  memoryTimestamp: string | undefined,
  questionDate: string | undefined,
): string | undefined {
  const memoryTime = parseSourceTimestamp(memoryTimestamp);
  if (memoryTime === undefined) return undefined;
  const date = new Date(memoryTime);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
  const questionTime = parseSourceTimestamp(questionDate);
  if (questionTime === undefined) return `weekday=${weekday}`;
  const delta = memoryTime - questionTime;
  const relation = delta <= 0 ? "before question" : "after question";
  return `weekday=${weekday}; ${durationParts(delta)} ${relation}`;
}
