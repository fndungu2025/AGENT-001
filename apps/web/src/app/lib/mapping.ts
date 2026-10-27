import type { ColumnMapping, MappingSuggestion } from "../../engine";

export function mappingFromSuggestions(s: MappingSuggestion[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const x of s) if (x.column !== null && x.confidence > 0) m[x.field] = x.column;
  return m;
}
