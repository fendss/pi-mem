import type { PiMemResult, PiMemRunError } from "../../evidence-agent/index.js";
import type { BenchmarkAnswerResult } from "./answer.js";

export interface BenchmarkPrediction {
  question_id: string;
  response: string;
  abstention: boolean;
  retrieval_status: PiMemResult["status"];
  citations: PiMemResult["citations"];
  count?: number;
  inventory?: PiMemResult["inventory"];
  metrics: PiMemResult["metrics"];
  retrieval: PiMemResult["retrieval"];
  retrieval_model: PiMemResult["retrievalModel"];
  answer_model: BenchmarkAnswerResult["model"];
  answer_prompt: {
    adapter: string;
    version: string;
    hash: string;
  };
  run_id: string;
}

export interface BenchmarkSuccessRecord {
  schema_version: 2;
  question_id: string;
  slot: number;
  prediction: BenchmarkPrediction;
  retrieval: PiMemResult;
  answer: BenchmarkAnswerResult;
}

export interface BenchmarkFailureRecord {
  schema_version: 1;
  question_id: string;
  slot: number;
  error: string;
  diagnostics?: PiMemRunError["diagnostics"];
}
