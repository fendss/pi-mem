import type {
  DenseRetriever,
  DenseSearchBatchRequest,
  DenseSearchHit,
} from "../ports/dense-retriever.js";

/** Prevents an optional expansion lane from weakening the baseline route. */
export class FailOpenDenseRetriever implements DenseRetriever {
  readonly retrievalProfile;
  readonly vectorGenerationId: string;
  readonly vectorCollection: string;

  constructor(private readonly delegate: DenseRetriever) {
    this.retrievalProfile = delegate.retrievalProfile;
    if (
      delegate.vectorGenerationId === undefined ||
      delegate.vectorCollection === undefined
    ) {
      throw new Error("Expansion retriever must identify its vector generation");
    }
    this.vectorGenerationId = delegate.vectorGenerationId;
    this.vectorCollection = delegate.vectorCollection;
  }

  async search(request: DenseSearchBatchRequest): Promise<DenseSearchHit[][]> {
    try {
      return await this.delegate.search(request);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      return request.queryVectors.map(() => []);
    }
  }
}
