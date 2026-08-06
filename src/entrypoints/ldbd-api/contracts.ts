export interface LdbdAddMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export interface LdbdAddRequest {
  requestId: string;
  userId: string;
  sessionId: string;
  messages: LdbdAddMessage[];
}

export interface LdbdSearchRequest {
  query: string;
  userId: string;
  topK: number;
  options: string[];
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} is too long`);
  return normalized;
}

export function parseAddRequest(value: unknown): LdbdAddRequest {
  const body = objectValue(value, "Add request");
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  if (body.messages.length > 100) throw new Error("messages exceeds the limit of 100");
  const messages = body.messages.map((item, index): LdbdAddMessage => {
    const message = objectValue(item, `messages[${index}]`);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error(`messages[${index}].role must be user or assistant`);
    }
    const timestamp = message.timestamp;
    if (
      timestamp !== undefined &&
      (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0)
    ) {
      throw new Error(`messages[${index}].timestamp must be a non-negative integer`);
    }
    return {
      role: message.role,
      content: stringValue(message.content, `messages[${index}].content`, 10_000),
      ...(timestamp === undefined ? {} : { timestamp }),
    };
  });
  return {
    requestId: stringValue(body.request_id, "request_id", 500),
    userId: stringValue(body.user_id, "user_id", 500),
    sessionId: stringValue(body.session_id, "session_id", 500),
    messages,
  };
}

export function parseSearchRequest(value: unknown): LdbdSearchRequest {
  const body = objectValue(value, "Search request");
  const topK = body.top_k;
  if (typeof topK !== "number" || !Number.isSafeInteger(topK) || topK < 1 || topK > 100) {
    throw new Error("top_k must be an integer between 1 and 100");
  }
  const rawOptions = body.options;
  if (rawOptions !== undefined && !Array.isArray(rawOptions)) {
    throw new Error("options must be an array when provided");
  }
  const options = (rawOptions ?? []).map((option, index) =>
    stringValue(option, `options[${index}]`, 20_000),
  );
  if (options.length > 16) throw new Error("options exceeds the limit of 16");
  return {
    query: stringValue(body.query, "query", 50_000),
    userId: stringValue(body.user_id, "user_id", 500),
    topK,
    options,
  };
}

export function renderRetrievalQuestion(request: LdbdSearchRequest): string {
  if (request.options.length === 0) return request.query;
  const options = request.options
    .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
    .join("\n");
  return `${request.query}\n\nAnswer candidates supplied by the benchmark (use them only to guide retrieval):\n${options}`;
}
