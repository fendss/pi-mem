import {
  MemoryArenaPublicError,
  type MemoryArenaAddInput,
  type MemoryArenaInitializeInput,
  type MemoryArenaWrapInput,
} from "../../benchmark/memoryarena-public/index.js";

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw contractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function contractError(message: string): MemoryArenaPublicError {
  return new MemoryArenaPublicError({
    code: "contract_error",
    message,
    httpStatus: 422,
  });
}

function exactFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  const unsupported = Object.keys(record).filter((key) => !accepted.has(key));
  if (unsupported.length > 0) {
    throw contractError(
      `${label} has unsupported fields: ${unsupported.sort().join(", ")}`,
    );
  }
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw contractError(`${label}.${field} must be a string`);
  }
  return value;
}

export function parseMemoryArenaInitializeRequest(
  value: unknown,
): MemoryArenaInitializeInput {
  const record = objectValue(value, "Initialize request");
  exactFields(record, ["user_id", "memory_system_name"], "Initialize request");
  return {
    userId: stringField(record, "user_id", "Initialize request"),
    memorySystemName: stringField(
      record,
      "memory_system_name",
      "Initialize request",
    ),
  };
}

export function parseMemoryArenaAddRequest(value: unknown): MemoryArenaAddInput {
  const record = objectValue(value, "Add request");
  exactFields(
    record,
    ["user_id", "memory_system_name", "chunk"],
    "Add request",
  );
  return {
    userId: stringField(record, "user_id", "Add request"),
    memorySystemName: stringField(record, "memory_system_name", "Add request"),
    chunk: stringField(record, "chunk", "Add request"),
  };
}

export function parseMemoryArenaWrapRequest(value: unknown): MemoryArenaWrapInput {
  const record = objectValue(value, "Wrap request");
  exactFields(
    record,
    ["user_id", "memory_system_name", "question"],
    "Wrap request",
  );
  return {
    userId: stringField(record, "user_id", "Wrap request"),
    memorySystemName: stringField(record, "memory_system_name", "Wrap request"),
    question: stringField(record, "question", "Wrap request"),
  };
}
