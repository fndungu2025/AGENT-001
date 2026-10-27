// Web Worker entry: runs analyze() off the main thread and posts progress and the result.
import { analyze } from "./analyze";
import type { AnalysisOptions, AnalysisResult, ColumnMapping, Progress, RawTable } from "./types";

export interface WorkerRequest {
  table: RawTable;
  mapping: ColumnMapping;
  options: AnalysisOptions;
}

export type WorkerMessage =
  | { type: "progress"; progress: Progress }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerMessage): void;
};

ctx.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  try {
    const { table, mapping, options } = e.data;
    const result = analyze(table, mapping, options, (progress) => {
      ctx.postMessage({ type: "progress", progress });
    });
    ctx.postMessage({ type: "result", result });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "The analysis failed unexpectedly.",
    });
  }
};
