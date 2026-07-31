import { readFile } from "node:fs/promises";
import type { BenchmarkAnswerPrompt } from "../benchmark-answer.js";
import type {
  BenchmarkQuery,
  MemoryRole,
  MemorySessionInput,
  MemoryTurnInput,
  PiMemResult,
} from "../types.js";
import { sha256 } from "../util.js";

const DATASET_NAMESPACE = "longmemeval_s_cleaned";
const SESSION_KEY = /^session_(\d+)$/u;
const TIMESTAMP =
  /^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/u;

type JsonObject = Record<string, unknown>;

export type LongMemEvalPrivateQuestion = BenchmarkQuery;

export interface LongMemEvalAdapterResult {
  memorySessions: MemorySessionInput[];
  privateQuestions: LongMemEvalPrivateQuestion[];
}

export const LONGMEMEVAL_ANSWER_PROMPT_VERSION = "longmemeval-answer-v4";

export const LONGMEMEVAL_ANSWER_PROMPT_TEMPLATE = `You are asked to answer a question based on your memories of a conversation.

<instructions>
1. Use only the provided immutable source memories. They are authoritative; use the retrieval summary and reference lines only as an index, and ignore any derived claim that conflicts with the raw memories.
2. The memories are episodic raw observations. Reason about what they imply; the answer need not appear verbatim.
3. The question may contain typos. Match it to the most relevant exact entity even if wording differs.
4. Distinguish completed observations from plans, questions, recommendations, and hypotheticals. Do not treat an intended or discussed event as completed.
5. When multiple answers are possible, list all supported answers, not just the first.
6. For counts, comparisons, or time intervals, enumerate the cited atomic facts first and perform exactly the operation requested. Do not expose this working in the final answer.
7. A value described as a total, cumulative, so far, or as-of snapshot replaces an earlier snapshot unless the source explicitly says it is an additional increment. Never add cumulative snapshots together.
8. Preserve specific names, titles, places, and labels from the memories.
9. Convert relative times into dates, months, or years only when the memory timestamp and question require it. Keep week-based expressions relative.
10. If memories conflict, prefer the most recent explicit supported memory only for current-state questions; otherwise preserve the distinction needed by the question.
11. For list questions, include all required items and no extras.
12. Answer the exact requested quantity or comparison. Keep the final answer minimal and do not add explanation, background, or extra dates unless needed for correctness.
</instructions>

<retrieval_package>
{{retrieval_package}}
</retrieval_package>

<memories role="user">
{{user_memories}}
</memories>

<memories role="assistant">
{{assistant_memories}}
</memories>

Question: {{question}}
Answer with the shortest correct phrase or sentence. No preamble, no fluff:`;

function renderAnswerMemory(memory: PiMemResult["evidence"][number]): string {
  const timestamp = memory.timestamp === undefined
    ? ""
    : ` time=${memory.timestamp}`;
  return `[memoryId=${memory.memoryId}${timestamp}]\n${memory.content}`;
}

export function buildLongMemEvalAnswerPrompt(
  question: string,
  retrieval: PiMemResult,
): BenchmarkAnswerPrompt {
  const citedIds = new Set(
    retrieval.citations.map((citation) => citation.memoryId),
  );
  const selected = retrieval.evidence.filter((memory) =>
    citedIds.has(memory.memoryId),
  );
  const userMemories = selected
    .filter((memory) => memory.role === "user")
    .map(renderAnswerMemory)
    .join("\n\n");
  const assistantMemories = selected
    .filter((memory) => memory.role !== "user")
    .map(renderAnswerMemory)
    .join("\n\n");
  const packageLines = [
    `status=${retrieval.status}`,
    `evidence_summary=${retrieval.evidenceSummary}`,
    ...(retrieval.count === undefined ? [] : [`count=${retrieval.count}`]),
    ...(retrieval.inventory ?? []).map(
      (item) =>
        `inventory=${item.item} [${item.memoryIds.join(", ")}]`,
    ),
    ...retrieval.citations.map(
      (citation) =>
        `reference memoryId=${citation.memoryId}: ${citation.supports}`,
    ),
  ];
  return {
    adapterId: "longmemeval-s",
    promptVersion: LONGMEMEVAL_ANSWER_PROMPT_VERSION,
    systemPrompt: "",
    userPrompt: LONGMEMEVAL_ANSWER_PROMPT_TEMPLATE
      .replace("{{retrieval_package}}", packageLines.join("\n"))
      .replace("{{user_memories}}", userMemories || "(none selected)")
      .replace(
        "{{assistant_memories}}",
        assistantMemories || "(none selected)",
      )
      .replace("{{question}}", question),
  };
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  return value;
}

function identifierAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function sourceTextAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function rawStringAt(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
  return value;
}

function optionalSourceText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return sourceTextAt(value, path);
}

function timestampParts(raw: string, path: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const match = TIMESTAMP.exec(raw);
  if (!match) {
    throw new TypeError(
      `${path} must match YYYY/MM/DD (Day) HH:mm, got ${JSON.stringify(raw)}`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    throw new TypeError(`${path} is not a valid calendar timestamp`);
  }
  return { year, month, day, hour, minute };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * LongMemEval timestamps carry no timezone. Return a sortable, timezone-free
 * representation instead of silently inventing UTC or per-turn timestamps.
 */
export function normalizeLongMemEvalTimestamp(
  raw: string,
  path = "timestamp",
): string {
  const { year, month, day, hour, minute } = timestampParts(raw, path);
  return `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}T${twoDigits(hour)}:${twoDigits(minute)}:00`;
}

export function longMemEvalScopeId(questionId: string): string {
  const normalized = identifierAt(questionId, "questionId");
  return `lme-s-${sha256(`${DATASET_NAMESPACE}\0${normalized}`).slice(0, 16)}`;
}

export function longMemEvalSessionId(
  scopeId: string,
  sourceSessionId: string,
): string {
  const scope = identifierAt(scopeId, "scopeId");
  const session = identifierAt(sourceSessionId, "sourceSessionId");
  return `s-${sha256(`${scope}\0${session}`).slice(0, 16)}`;
}

export function longMemEvalMemoryId(
  scopeId: string,
  sourceDiaId: string,
): string {
  const scope = identifierAt(scopeId, "scopeId");
  const diaId = identifierAt(sourceDiaId, "sourceDiaId");
  return `m-${sha256(`${scope}\0${diaId}`).slice(0, 24)}`;
}

function roleFor(
  speaker: string,
  speakerA: string,
  speakerB: string,
): MemoryRole {
  const normalized = speaker.normalize("NFKC").trim().toLocaleLowerCase();
  if (normalized === "user" || normalized === "human") return "user";
  if (
    normalized === "assistant" ||
    normalized === "ai" ||
    normalized === "bot"
  ) {
    return "assistant";
  }
  if (speaker === speakerA) return "user";
  if (speaker === speakerB) return "assistant";
  if (normalized === "system") return "system";
  return "other";
}

function numericSessionIndex(key: string): number {
  const match = SESSION_KEY.exec(key);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

/**
 * Trusted benchmark boundary. It deliberately reconstructs every memory
 * object from a small conversation whitelist; no raw object is ever spread
 * into the result.
 */
export function adaptLongMemEvalS(raw: unknown): LongMemEvalAdapterResult {
  const records = arrayAt(raw, "dataset");
  const memorySessions: MemorySessionInput[] = [];
  const privateQuestions: LongMemEvalPrivateQuestion[] = [];
  const seenQuestionIds = new Set<string>();
  const seenScopeIds = new Set<string>();

  records.forEach((rawRecord, recordIndex) => {
    const recordPath = `dataset[${recordIndex}]`;
    const record = objectAt(rawRecord, recordPath);
    const conversation = objectAt(
      record["conversation"],
      `${recordPath}.conversation`,
    );
    const qa = arrayAt(record["qa"], `${recordPath}.qa`);
    if (qa.length !== 1) {
      throw new TypeError(
        `${recordPath}.qa must contain exactly one LongMemEval-S question`,
      );
    }
    const question = objectAt(qa[0], `${recordPath}.qa[0]`);
    const questionId = identifierAt(
      question["question_id"],
      `${recordPath}.qa[0].question_id`,
    );
    const questionText = sourceTextAt(
      question["question"],
      `${recordPath}.qa[0].question`,
    );
    if (seenQuestionIds.has(questionId)) {
      throw new Error(`Duplicate LongMemEval question_id: ${questionId}`);
    }
    seenQuestionIds.add(questionId);

    const scopeId = longMemEvalScopeId(questionId);
    if (seenScopeIds.has(scopeId)) {
      throw new Error(`Opaque LongMemEval scope collision: ${scopeId}`);
    }
    seenScopeIds.add(scopeId);

    const metadata = objectAt(
      record["metadata"],
      `${recordPath}.metadata`,
    );
    const questionDate = optionalSourceText(
      metadata["question_date"],
      `${recordPath}.metadata.question_date`,
    );
    if (questionDate !== undefined) {
      normalizeLongMemEvalTimestamp(
        questionDate,
        `${recordPath}.metadata.question_date`,
      );
    }
    const privateQuestion: LongMemEvalPrivateQuestion = {
      scopeId,
      questionId,
      question: questionText,
      ...(questionDate === undefined ? {} : { questionDate }),
    };
    privateQuestions.push(privateQuestion);

    const speakerA = identifierAt(
      conversation["speaker_a"],
      `${recordPath}.conversation.speaker_a`,
    );
    const speakerB = identifierAt(
      conversation["speaker_b"],
      `${recordPath}.conversation.speaker_b`,
    );
    const sourceSessionIds = Object.keys(conversation)
      .filter((key) => SESSION_KEY.test(key))
      .sort((left, right) => {
        const numeric = numericSessionIndex(left) - numericSessionIndex(right);
        return numeric !== 0 ? numeric : left.localeCompare(right);
      });
    if (sourceSessionIds.length === 0) {
      throw new TypeError(`${recordPath}.conversation has no sessions`);
    }

    const seenDiaIds = new Set<string>();
    const seenSessionIds = new Set<string>();
    const seenMemoryIds = new Set<string>();
    for (const sourceSessionId of sourceSessionIds) {
      const sessionPath = `${recordPath}.conversation.${sourceSessionId}`;
      const rawTurns = arrayAt(conversation[sourceSessionId], sessionPath);
      if (rawTurns.length === 0) {
        throw new TypeError(`${sessionPath} must not be empty`);
      }
      const timestampKey = `${sourceSessionId}_date_time`;
      const timestampRaw = sourceTextAt(
        conversation[timestampKey],
        `${recordPath}.conversation.${timestampKey}`,
      );
      const timestamp = normalizeLongMemEvalTimestamp(
        timestampRaw,
        `${recordPath}.conversation.${timestampKey}`,
      );
      const sessionId = longMemEvalSessionId(scopeId, sourceSessionId);
      if (seenSessionIds.has(sessionId)) {
        throw new Error(`Opaque LongMemEval session collision: ${sessionId}`);
      }
      seenSessionIds.add(sessionId);

      const turns: MemoryTurnInput[] = rawTurns.map((rawTurn, turnIndex) => {
        const turnPath = `${sessionPath}[${turnIndex}]`;
        const turn = objectAt(rawTurn, turnPath);
        const diaId = identifierAt(turn["dia_id"], `${turnPath}.dia_id`);
        if (seenDiaIds.has(diaId)) {
          throw new Error(
            `Duplicate dia_id ${JSON.stringify(diaId)} in scope ${scopeId}`,
          );
        }
        seenDiaIds.add(diaId);

        const speaker = identifierAt(
          turn["speaker"],
          `${turnPath}.speaker`,
        );
        // The cleaned S split contains a small number of genuine empty turns.
        // Preserve them as source records; dropping them would break addressing
        // and violate the immutable-raw-memory boundary.
        const text = rawStringAt(turn["text"], `${turnPath}.text`);
        const memoryId = longMemEvalMemoryId(scopeId, diaId);
        if (seenMemoryIds.has(memoryId)) {
          throw new Error(`Opaque LongMemEval memory collision: ${memoryId}`);
        }
        seenMemoryIds.add(memoryId);

        return {
          id: memoryId,
          role: roleFor(speaker, speakerA, speakerB),
          content: text,
          metadata: {
            sourceDiaId: diaId,
            sourceSpeaker: speaker,
          },
        };
      });

      memorySessions.push({
        scopeId,
        sessionId,
        timestamp,
        turns,
        metadata: {
          sourceSessionId,
          sessionTimeRaw: timestampRaw,
          speakerA,
          speakerB,
        },
      });
    }
  });

  return { memorySessions, privateQuestions };
}

export async function loadLongMemEvalS(
  path: string,
): Promise<LongMemEvalAdapterResult> {
  const serialized = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Failed to parse LongMemEval-S JSON at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return adaptLongMemEvalS(parsed);
}
