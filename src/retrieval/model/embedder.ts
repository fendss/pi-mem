export interface EmbeddingRequestOptions {
  signal?: AbortSignal;
}

export interface EmbeddingMetrics {
  calls: number;
  latencyMs: number;
}

export interface Embedder {
  readonly profileId: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxInputLength: number;
  readonly batchSize: number;
  embedDocuments(
    texts: readonly string[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]>;
  embedQueries(
    texts: readonly string[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]>;
  snapshotMetrics(): EmbeddingMetrics;
}
