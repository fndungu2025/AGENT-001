// Public API of the in-browser analytics engine (signatures are frozen, see ./types.ts).
// Everything runs locally: no data leaves the browser.
import { analyze } from "./analyze";
import { suggestMappingFor } from "./mapping";
import { parseUpload } from "./parse";
import { generateSample as buildSample } from "./sample";
import type {
  AnalysisOptions,
  AnalysisResult,
  ColumnMapping,
  MappingSuggestion,
  Progress,
  RawTable,
} from "./types";
import type { WorkerMessage, WorkerRequest } from "./worker";

export * from "./types";
export { FEATURE_LABELS } from "./explain";
export { SEGMENT_INFO, SEGMENT_ORDER } from "./rfm";
export { DEFAULT_NON_PRODUCT_CODES } from "./clean";
export { ParseError } from "./parse";

export const DEFAULT_OPTIONS: AnalysisOptions = {
  cancellationMode: "net",
  dateOrder: "auto",
  horizonDays: 60,
};

/** Parse a CSV/TSV/TXT/XLSX upload into a raw table (friendly `Error` messages on failure). */
export function parseFile(file: File): Promise<RawTable> {
  return parseUpload(file);
}

export function suggestMapping(columns: string[]): MappingSuggestion[] {
  return suggestMappingFor(columns);
}

/** Deterministic SYNTHETIC demo data (marked `synthetic: true`). */
export function generateSample(): RawTable {
  return buildSample();
}

export interface AnalysisJob {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

/**
 * Run the analysis in a Web Worker. `cancel()` terminates the worker and rejects the promise with
 * an Error whose message is "Analysis cancelled". Without Worker support (tests, old browsers)
 * it falls back to running on the calling thread.
 */
export function analyzeInWorker(
  table: RawTable,
  mapping: ColumnMapping,
  options: AnalysisOptions,
  onProgress?: (p: Progress) => void,
): AnalysisJob {
  if (typeof Worker === "undefined") {
    let cancelled = false;
    const promise = new Promise<AnalysisResult>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) {
          reject(new Error("Analysis cancelled"));
          return;
        }
        try {
          resolve(analyze(table, mapping, options, onProgress));
        } catch (err) {
          reject(err instanceof Error ? err : new Error("The analysis failed unexpectedly."));
        }
      }, 0);
    });
    return {
      promise,
      cancel: () => {
        cancelled = true;
      },
    };
  }
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent<WorkerMessage>): void => {
      const msg = e.data;
      if (msg.type === "progress") onProgress?.(msg.progress);
      else if (msg.type === "result") {
        worker.terminate();
        resolve(msg.result);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(e.message || "The analysis stopped unexpectedly. Try a smaller file."));
    };
    const req: WorkerRequest = { table, mapping, options };
    worker.postMessage(req);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new Error("Analysis cancelled"));
    },
  };
}
