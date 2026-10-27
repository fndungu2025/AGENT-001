// File parsing: CSV/TSV/TXT (papaparse, UTF-8 with windows-1252 fallback) and XLSX
// (read-excel-file, all sheets with the same header concatenated).
import Papa from "papaparse";
import type { RawTable } from "./types";

export const MAX_ROWS = 2_000_000;

export class ParseError extends Error {}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() === "" ? `Column ${i + 1}` : h.trim();
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base} (${k})`;
  });
}

function toTable(data: string[][], name: string): RawTable {
  if (data.length === 0) throw new ParseError("The file is empty.");
  const header = data[0]!;
  if (header.every((h) => h.trim() === "")) {
    throw new ParseError("The first row has no column names. Add a header row and try again.");
  }
  const columns = uniqueHeaders(header);
  const width = columns.length;
  const rows: string[][] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i]!;
    if (r.length === 1 && r[0] === "") continue; // blank line
    if (r.length !== width) {
      const fixed = r.slice(0, width);
      while (fixed.length < width) fixed.push("");
      rows.push(fixed);
    } else rows.push(r);
  }
  if (rows.length === 0) throw new ParseError("The file has a header but no data rows.");
  if (rows.length > MAX_ROWS) {
    throw new ParseError(
      `The file has ${rows.length.toLocaleString("en-GB")} rows; the in-browser limit is ${MAX_ROWS.toLocaleString("en-GB")}. Split the file or filter it to the period you need.`,
    );
  }
  return { columns, rows, name };
}

/** Parse CSV/TSV text (pure; used by tests). Delimiter is auto-detected. */
export function parseCsvText(text: string, name: string): RawTable {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (clean.trim() === "") throw new ParseError("The file is empty.");
  const res = Papa.parse<string[]>(clean, {
    delimitersToGuess: [",", ";", "\t", "|"],
    skipEmptyLines: "greedy",
  });
  const data = res.data;
  if (data.length > MAX_ROWS + 1) {
    throw new ParseError(
      `The file has more than ${MAX_ROWS.toLocaleString("en-GB")} rows, which is beyond the in-browser limit.`,
    );
  }
  return toTable(data, name);
}

function readAllBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (): void => {
      resolve(new Uint8Array(fr.result as ArrayBuffer));
    };
    fr.onerror = (): void => {
      reject(new ParseError("The file could not be read."));
    };
    fr.readAsArrayBuffer(file);
  });
}

async function decodeFile(file: File): Promise<string> {
  const streamed = typeof file.stream === "function";
  const read = async (label: string, fatal: boolean): Promise<string> => {
    const decoder = new TextDecoder(label, { fatal });
    if (!streamed) return decoder.decode(await readAllBytes(file));
    // stream in chunks so a very large file never needs one giant intermediate buffer
    const reader = file.stream().getReader();
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  };
  try {
    return await read("utf-8", true);
  } catch {
    return read("windows-1252", false);
  }
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
    return iso.endsWith("T00:00:00.000Z")
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

async function parseXlsx(file: File): Promise<RawTable> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(file)) as { sheet: string; data: unknown[][] }[];
  } catch {
    throw new ParseError(
      "This Excel file could not be read. Save it as .xlsx or CSV and try again.",
    );
  }
  let header: string[] | null = null;
  const merged: string[][] = [];
  for (const sh of sheets) {
    if (sh.data.length === 0) continue;
    const h = sh.data[0]!.map(cellToString);
    if (h.every((x) => x.trim() === "")) continue;
    if (header === null) {
      header = h;
      merged.push(h);
    } else if (
      h.map((x) => x.trim()).join("\u0001") !== header.map((x) => x.trim()).join("\u0001")
    ) {
      continue; // a sheet with a different header is not part of the order data
    }
    for (let i = 1; i < sh.data.length; i++) {
      merged.push(sh.data[i]!.map(cellToString));
      if (merged.length > MAX_ROWS + 1) {
        throw new ParseError(
          `The workbook has more than ${MAX_ROWS.toLocaleString("en-GB")} rows, which is beyond the in-browser limit.`,
        );
      }
    }
  }
  return toTable(merged, file.name);
}

export async function parseUpload(file: File): Promise<RawTable> {
  if (file.size === 0) throw new ParseError("The file is empty.");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsx(file);
  if (lower.endsWith(".xls")) {
    throw new ParseError("Old .xls files are not supported. Save the file as .xlsx or CSV.");
  }
  const text = await decodeFile(file);
  return parseCsvText(text, file.name);
}
