import type { PiMemResult, PiMemRunError } from "../../evidence-agent/index.js";
import type { BenchmarkAnswerResult } from "./answer.js";

export type EvidenceBenchmarkId = "ama-bench";

export type BenchmarkResponse = { kind: "text"; text: string };

export interface EvidenceBenchmarkPrediction {
  schema_version: 1;
  benchmark: EvidenceBenchmarkId;
  case_id: string;
  scope_id: string;
  response: BenchmarkResponse;
  abstention: boolean;
  retrieval_status: PiMemResult["status"];
  citations: PiMemResult["citations"];
  retrieval_model: PiMemResult["retrievalModel"];
  answer_model: BenchmarkAnswerResult["model"];
  answer_prompt: {
    adapter: string;
    version: string;
    hash: string;
  };
  run_id: string;
}

export interface EvidenceBenchmarkSuccessRecord {
  schema_version: 1;
  benchmark: EvidenceBenchmarkId;
  case_id: string;
  slot: number;
  prediction: EvidenceBenchmarkPrediction;
  retrieval: PiMemResult;
  answer: BenchmarkAnswerResult;
}

export interface EvidenceBenchmarkFailureRecord {
  schema_version: 1;
  benchmark: EvidenceBenchmarkId;
  case_id: string;
  slot: number;
  error: string;
  diagnostics?: PiMemRunError["diagnostics"];
}
