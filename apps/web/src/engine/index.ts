// Public API of the analytics engine. OWNED BY THE ENGINE AGENT: this stub is replaced by the
// real implementation; signatures are frozen (see ./types.ts).
import type {
  AnalysisOptions,
  AnalysisResult,
  ColumnMapping,
  MappingSuggestion,
  Progress,
  RawTable,
} from "./types";

export * from "./types";

export const DEFAULT_OPTIONS: AnalysisOptions = {
  cancellationMode: "net",
  dateOrder: "auto",
  horizonDays: 60,
};

export function parseFile(_file: File): Promise<RawTable> {
  return Promise.reject(new Error("engine not implemented yet"));
}

export function suggestMapping(_columns: string[]): MappingSuggestion[] {
  return [];
}

export function generateSample(): RawTable {
  throw new Error("engine not implemented yet");
}

export interface AnalysisJob {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

export function analyzeInWorker(
  _table: RawTable,
  _mapping: ColumnMapping,
  _options: AnalysisOptions,
  _onProgress?: (p: Progress) => void,
): AnalysisJob {
  return { promise: Promise.reject(new Error("engine not implemented yet")), cancel: () => {} };
}
