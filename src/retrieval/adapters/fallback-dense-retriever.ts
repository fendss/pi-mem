import type {
  DenseRetriever,
  DenseSearchBatchRequest,
  DenseSearchHit,
} from "../ports/dense-retriever.js";

/** Uses the scalable dense engine first and preserves exact SQLite recovery. */
export class FallbackDenseRetriever implements DenseRetriever {
  readonly retrievalProfile;
  readonly vectorGenerationId: string;
  readonly vectorCollection: string;

  constructor(
    private readonly primary: DenseRetriever,
    private readonly fallback: DenseRetriever,
  ) {
    this.retrievalProfile = primary.retrievalProfile;
    if (
      primary.vectorGenerationId === undefined ||
      primary.vectorCollection === undefined
    ) {
      throw new Error("Primary dense retriever must identify its vector generation");
    }
    this.vectorGenerationId = primary.vectorGenerationId;
    this.vectorCollection = primary.vectorCollection;
  }

  async search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]> {
    try {
      return await this.primary.search(request);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      return this.fallback.search(request);
    }
  }
}
