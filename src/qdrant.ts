import type { MemoryRole } from "./types.js";

export const QDRANT_COLLECTION_SCHEMA_VERSION = 1;

export interface QdrantHnswConfig {
  m: number;
  efConstruct: number;
  fullScanThresholdKb: number;
}

export interface QdrantCollectionSpec {
  name: string;
  dimensions: number;
  indexingThresholdKb: number;
  hnsw: QdrantHnswConfig;
}

export interface QdrantVectorPoint {
  pointId: string;
  vector: readonly number[];
  generationId: string;
  scopeId: string;
  memoryId: string;
  sessionId: string;
  role: MemoryRole;
  timestamp?: string;
  profileId: string;
  contentHash: string;
}

export interface QdrantSearchRequest {
  collection: string;
  vector: readonly number[];
  generationId: string;
  scopeId: string;
  profileId: string;
  sessionIds?: string[];
  roles?: MemoryRole[];
  after?: string;
  before?: string;
  limit: number;
  hnswEf: number;
  signal?: AbortSignal;
}

export interface QdrantSearchHit {
  pointId: string;
  score: number;
  generationId: string;
  scopeId: string;
  memoryId: string;
  sessionId: string;
  role: MemoryRole;
  timestamp?: string;
  profileId: string;
  contentHash: string;
}

export interface QdrantClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface QdrantEnvelope {
  result?: unknown;
  status?: unknown;
}

export interface QdrantCollectionInfo {
  status: string;
  optimizerStatus: string;
  pointsCount: number;
  indexedVectorsCount: number;
  segmentsCount: number;
  dimensions: number;
  indexingThresholdKb: number;
  distance: string;
  hnsw: QdrantHnswConfig;
}

export interface QdrantCountRequest {
  collection: string;
  generationId: string;
  profileId: string;
  scopeId?: string;
  signal?: AbortSignal;
}

export class QdrantHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "QdrantHttpError";
    this.status = status;
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function nonEmptyString(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function memoryRole(value: unknown, label: string): MemoryRole {
  if (!new Set(["user", "assistant", "system", "other"]).has(value as string)) {
    throw new Error(`${label} must be a supported memory role`);
  }
  return value as MemoryRole;
}

function collectionName(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,255}$/u.test(value)) {
    throw new Error(
      "Qdrant collection name must contain only letters, digits, underscores, or hyphens",
    );
  }
  return value;
}

function qdrantBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Qdrant base URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("Qdrant base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Qdrant base URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Qdrant base URL must not contain a query or fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteVector(vector: readonly number[], dimensions?: number): number[] {
  if (dimensions !== undefined && vector.length !== dimensions) {
    throw new Error(`Qdrant vector must contain ${dimensions} dimensions`);
  }
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Qdrant vector must be non-empty and finite");
  }
  return [...vector];
}

function responseMessage(status: number, body: string): string {
  const compact = body.replace(/\s+/gu, " ").trim().slice(0, 500);
  return compact
    ? `Qdrant returned HTTP ${status}: ${compact}`
    : `Qdrant returned HTTP ${status}`;
}

function responseSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function optimizerStatus(value: unknown): string {
  if (typeof value === "string") return nonEmptyString(value, "Qdrant optimizer status");
  const status = objectValue(value, "Qdrant optimizer status");
  return nonEmptyString(String(status.status ?? ""), "Qdrant optimizer status");
}

function collectionInfo(value: unknown): QdrantCollectionInfo {
  const envelope = objectValue(value, "Qdrant collection response");
  const result = objectValue(envelope.result, "Qdrant collection result");
  const config = objectValue(result.config, "Qdrant collection config");
  const params = objectValue(config.params, "Qdrant collection parameters");
  const vectors = objectValue(params.vectors, "Qdrant vector parameters");
  const hnsw = objectValue(config.hnsw_config, "Qdrant HNSW parameters");
  const optimizer = objectValue(
    config.optimizer_config,
    "Qdrant optimizer parameters",
  );
  const status = nonEmptyString(String(result.status ?? ""), "Qdrant status");
  return {
    status,
    optimizerStatus: optimizerStatus(result.optimizer_status),
    pointsCount: nonNegativeInteger(
      Number(result.points_count),
      "Qdrant point count",
    ),
    indexedVectorsCount: nonNegativeInteger(
      Number(result.indexed_vectors_count),
      "Qdrant indexed vector count",
    ),
    segmentsCount: positiveInteger(
      Number(result.segments_count),
      "Qdrant segment count",
    ),
    dimensions: positiveInteger(Number(vectors.size), "Qdrant vector size"),
    indexingThresholdKb: positiveInteger(
      Number(optimizer.indexing_threshold),
      "Qdrant optimizer indexing threshold",
    ),
    distance: nonEmptyString(String(vectors.distance ?? ""), "Qdrant distance"),
    hnsw: {
      m: positiveInteger(Number(hnsw.m), "Qdrant HNSW m"),
      efConstruct: positiveInteger(
        Number(hnsw.ef_construct),
        "Qdrant HNSW ef_construct",
      ),
      fullScanThresholdKb: positiveInteger(
        Number(hnsw.full_scan_threshold),
        "Qdrant HNSW full_scan_threshold",
      ),
    },
  };
}

export class QdrantClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QdrantClientOptions) {
    this.baseUrl = qdrantBaseUrl(options.baseUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, "Qdrant timeout");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private endpoint(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      acceptedStatuses?: readonly number[];
    } = {},
  ): Promise<{ status: number; value: unknown }> {
    const response = await this.fetchImpl(this.endpoint(path), {
      method,
      headers: options.body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: responseSignal(this.timeoutMs, options.signal),
    });
    const body = await response.text();
    const accepted = options.acceptedStatuses ?? [200];
    if (!accepted.includes(response.status)) {
      throw new QdrantHttpError(
        response.status,
        responseMessage(response.status, body),
      );
    }
    if (!body.trim()) return { status: response.status, value: undefined };
    try {
      return { status: response.status, value: JSON.parse(body) as unknown };
    } catch {
      return { status: response.status, value: body };
    }
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.request("GET", "/readyz", {
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async getCollection(
    name: string,
    signal?: AbortSignal,
  ): Promise<QdrantCollectionInfo | undefined> {
    const result = await this.request(
      "GET",
      `/collections/${encodeURIComponent(collectionName(name))}`,
      {
        acceptedStatuses: [200, 404],
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return result.status === 404 ? undefined : collectionInfo(result.value);
  }

  async ensureCollection(
    spec: QdrantCollectionSpec,
    signal?: AbortSignal,
  ): Promise<void> {
    collectionName(spec.name);
    positiveInteger(spec.dimensions, "Qdrant collection dimensions");
    positiveInteger(spec.hnsw.m, "Qdrant HNSW m");
    positiveInteger(spec.hnsw.efConstruct, "Qdrant HNSW efConstruct");
    positiveInteger(
      spec.hnsw.fullScanThresholdKb,
      "Qdrant HNSW fullScanThresholdKb",
    );
    positiveInteger(
      spec.indexingThresholdKb,
      "Qdrant optimizer indexingThresholdKb",
    );
    let info = await this.getCollection(spec.name, signal);
    if (info === undefined) {
      await this.request(
        "PUT",
        `/collections/${encodeURIComponent(spec.name)}`,
        {
          body: {
            vectors: { size: spec.dimensions, distance: "Cosine" },
            hnsw_config: {
              m: spec.hnsw.m,
              ef_construct: spec.hnsw.efConstruct,
              full_scan_threshold: spec.hnsw.fullScanThresholdKb,
            },
            optimizers_config: {
              indexing_threshold: spec.indexingThresholdKb,
            },
            on_disk_payload: false,
          },
          ...(signal === undefined ? {} : { signal }),
        },
      );
      info = await this.getCollection(spec.name, signal);
      if (info === undefined) {
        throw new Error(`Qdrant collection was not created: ${spec.name}`);
      }
    }
    if (
      info.dimensions !== spec.dimensions ||
      info.distance.toLowerCase() !== "cosine" ||
      info.hnsw.m !== spec.hnsw.m ||
      info.hnsw.efConstruct !== spec.hnsw.efConstruct ||
      info.hnsw.fullScanThresholdKb !== spec.hnsw.fullScanThresholdKb ||
      info.indexingThresholdKb !== spec.indexingThresholdKb
    ) {
      throw new Error(`Qdrant collection configuration mismatch: ${spec.name}`);
    }
    await this.ensurePayloadIndex(
      spec.name,
      "scope_id",
      { type: "keyword", is_tenant: true },
      signal,
    );
    await this.ensurePayloadIndex(
      spec.name,
      "profile_id",
      { type: "keyword" },
      signal,
    );
    await this.ensurePayloadIndex(
      spec.name,
      "generation_id",
      { type: "keyword" },
      signal,
    );
    await this.ensurePayloadIndex(
      spec.name,
      "session_id",
      { type: "keyword" },
      signal,
    );
    await this.ensurePayloadIndex(
      spec.name,
      "role",
      { type: "keyword" },
      signal,
    );
    await this.ensurePayloadIndex(
      spec.name,
      "timestamp",
      { type: "datetime" },
      signal,
    );
  }

  private async ensurePayloadIndex(
    collection: string,
    fieldName: string,
    fieldSchema: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      "PUT",
      `/collections/${encodeURIComponent(collectionName(collection))}/index?wait=true`,
      {
        body: { field_name: fieldName, field_schema: fieldSchema },
        ...(signal === undefined ? {} : { signal }),
      },
    );
  }

  async upsert(
    collection: string,
    dimensions: number,
    points: readonly QdrantVectorPoint[],
    signal?: AbortSignal,
  ): Promise<void> {
    collectionName(collection);
    positiveInteger(dimensions, "Qdrant vector dimensions");
    if (points.length === 0) return;
    if (new Set(points.map((point) => point.pointId)).size !== points.length) {
      throw new Error("Qdrant upsert batch contains duplicate point IDs");
    }
    await this.request(
      "PUT",
      `/collections/${encodeURIComponent(collection)}/points?wait=true`,
      {
        body: {
          points: points.map((point) => ({
            id: nonEmptyString(point.pointId, "Qdrant point ID"),
            vector: finiteVector(point.vector, dimensions),
            payload: {
              generation_id: nonEmptyString(
                point.generationId,
                "Qdrant generation ID",
              ),
              scope_id: nonEmptyString(point.scopeId, "Qdrant scope ID"),
              memory_id: nonEmptyString(point.memoryId, "Qdrant memory ID"),
              session_id: nonEmptyString(point.sessionId, "Qdrant session ID"),
              role: memoryRole(point.role, "Qdrant memory role"),
              ...(point.timestamp === undefined
                ? {}
                : { timestamp: nonEmptyString(point.timestamp, "Qdrant timestamp") }),
              profile_id: nonEmptyString(point.profileId, "Qdrant profile ID"),
              content_hash: nonEmptyString(
                point.contentHash,
                "Qdrant content hash",
              ),
              schema_version: QDRANT_COLLECTION_SCHEMA_VERSION,
            },
          })),
        },
        ...(signal === undefined ? {} : { signal }),
      },
    );
  }

  async count(request: QdrantCountRequest): Promise<number> {
    collectionName(request.collection);
    const must: Array<Record<string, unknown>> = [
      {
        key: "generation_id",
        match: {
          value: nonEmptyString(request.generationId, "Qdrant generation ID"),
        },
      },
      {
        key: "profile_id",
        match: { value: nonEmptyString(request.profileId, "Qdrant profile ID") },
      },
    ];
    if (request.scopeId !== undefined) {
      must.push({
        key: "scope_id",
        match: { value: nonEmptyString(request.scopeId, "Qdrant scope ID") },
      });
    }
    const response = await this.request(
      "POST",
      `/collections/${encodeURIComponent(request.collection)}/points/count`,
      {
        body: { filter: { must }, exact: true },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    const envelope = objectValue(response.value, "Qdrant count response");
    const result = objectValue(envelope.result, "Qdrant count result");
    return nonNegativeInteger(Number(result.count), "Qdrant filtered point count");
  }

  async search(request: QdrantSearchRequest): Promise<QdrantSearchHit[]> {
    collectionName(request.collection);
    positiveInteger(request.limit, "Qdrant search limit");
    positiveInteger(request.hnswEf, "Qdrant search hnswEf");
    const must: Array<Record<string, unknown>> = [
      {
        key: "generation_id",
        match: {
          value: nonEmptyString(request.generationId, "Qdrant generation ID"),
        },
      },
      {
        key: "scope_id",
        match: { value: nonEmptyString(request.scopeId, "Qdrant scope ID") },
      },
      {
        key: "profile_id",
        match: { value: nonEmptyString(request.profileId, "Qdrant profile ID") },
      },
    ];
    if (request.sessionIds && request.sessionIds.length > 0) {
      must.push({
        key: "session_id",
        match: {
          any: request.sessionIds.map((value) =>
            nonEmptyString(value, "Qdrant session filter")
          ),
        },
      });
    }
    if (request.roles && request.roles.length > 0) {
      must.push({
        key: "role",
        match: {
          any: request.roles.map((value) => memoryRole(value, "Qdrant role filter")),
        },
      });
    }
    if (request.after || request.before) {
      must.push({
        key: "timestamp",
        range: {
          ...(request.after === undefined
            ? {}
            : { gte: nonEmptyString(request.after, "Qdrant lower time bound") }),
          ...(request.before === undefined
            ? {}
            : { lte: nonEmptyString(request.before, "Qdrant upper time bound") }),
        },
      });
    }
    const response = await this.request(
      "POST",
      `/collections/${encodeURIComponent(request.collection)}/points/search`,
      {
        body: {
          vector: finiteVector(request.vector),
          filter: { must },
          params: { hnsw_ef: request.hnswEf, exact: false },
          limit: request.limit,
          with_payload: [
            "generation_id",
            "scope_id",
            "memory_id",
            "session_id",
            "role",
            "timestamp",
            "profile_id",
            "content_hash",
          ],
          with_vector: false,
        },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    const envelope = objectValue(response.value, "Qdrant search response");
    if (!Array.isArray(envelope.result)) {
      throw new Error("Qdrant search result must be an array");
    }
    return envelope.result.map((raw, index) => {
      const hit = objectValue(raw, `Qdrant search result ${index}`);
      const payload = objectValue(
        hit.payload,
        `Qdrant search result ${index} payload`,
      );
      const generationId = nonEmptyString(
        String(payload.generation_id ?? ""),
        "Qdrant result generation ID",
      );
      const scopeId = nonEmptyString(
        String(payload.scope_id ?? ""),
        "Qdrant result scope ID",
      );
      const memoryId = nonEmptyString(
        String(payload.memory_id ?? ""),
        "Qdrant result memory ID",
      );
      const sessionId = nonEmptyString(
        String(payload.session_id ?? ""),
        "Qdrant result session ID",
      );
      const role = memoryRole(payload.role, "Qdrant result memory role");
      const timestamp = payload.timestamp === undefined
        ? undefined
        : nonEmptyString(String(payload.timestamp), "Qdrant result timestamp");
      const profileId = nonEmptyString(
        String(payload.profile_id ?? ""),
        "Qdrant result profile ID",
      );
      if (
        generationId !== request.generationId ||
        scopeId !== request.scopeId ||
        profileId !== request.profileId ||
        (request.sessionIds !== undefined && request.sessionIds.length > 0 &&
          !request.sessionIds.includes(sessionId)) ||
        (request.roles !== undefined && request.roles.length > 0 &&
          !request.roles.includes(role)) ||
        (request.after !== undefined &&
          (timestamp === undefined || timestamp < request.after)) ||
        (request.before !== undefined &&
          (timestamp === undefined || timestamp > request.before))
      ) {
        throw new Error("Qdrant returned a result outside the mandatory scope filter");
      }
      const score = Number(hit.score);
      if (!Number.isFinite(score)) {
        throw new Error("Qdrant search score must be finite");
      }
      return {
        pointId: nonEmptyString(String(hit.id ?? ""), "Qdrant result point ID"),
        score,
        generationId,
        scopeId,
        memoryId,
        sessionId,
        role,
        ...(timestamp === undefined ? {} : { timestamp }),
        profileId,
        contentHash: nonEmptyString(
          String(payload.content_hash ?? ""),
          "Qdrant result content hash",
        ),
      };
    });
  }
}
