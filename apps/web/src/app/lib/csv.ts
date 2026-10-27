// CSV building with spreadsheet-injection protection (cells starting with = + - @ get a leading
// apostrophe) and RFC 4180 quoting.
import type { AnalysisResult, CustomerRow, SegmentSummary } from "../../engine";
import { bandMeta, segmentName } from "../meta";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "number") {
    s = Number.isFinite(value) ? String(value) : "";
    return s;
  }
  s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export const TARGET_HEADER = [
  "customer_id",
  "segment",
  "cluster",
  "chance_to_buy_again",
  "risk_band",
  "recency_days",
  "frequency_orders",
  "value",
  "expected_value",
  "top_driver",
];

export function targetListCsv(customers: CustomerRow[], segments: SegmentSummary[]): string {
  return toCsv(
    TARGET_HEADER,
    customers.map((c) => [
      c.id,
      segmentName(c.segment, segments),
      c.cluster + 1,
      Math.round(c.pRepeat * 10000) / 10000,
      bandMeta(c.riskBand).label,
      c.recencyDays,
      c.frequency,
      c.monetary,
      c.expectedValue,
      c.drivers[0]?.text ?? "",
    ]),
  );
}

export function qualityCsv(result: AnalysisResult): string {
  const q = result.quality;
  const rows: (string | number | boolean)[][] = q.rules.map((r) => [r.id, r.description, r.rows, r.revenue]);
  rows.push(["", "", "", ""]);
  rows.push(["rows_read", "", q.rowsRead, ""]);
  rows.push(["rows_kept", "", q.rowsKept, ""]);
  rows.push(["gross_revenue", "", "", q.reconciliation.gross]);
  rows.push(["cancellations", "", "", q.reconciliation.cancellations]);
  rows.push(["excluded", "", "", q.reconciliation.excluded]);
  rows.push(["net_revenue", "", "", q.reconciliation.net]);
  rows.push(["reconciliation_balances", "", "", q.reconciliation.balances]);
  for (const w of q.warnings) rows.push([`warning:${w.code}`, `${w.severity}: ${w.message}`, "", ""]);
  return toCsv(["rule", "description", "rows", "revenue"], rows);
}

export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
