/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Value parsing helpers (PRD A.1): numbers, dates, ids. Pure functions, no DOM.
import { sha256Hex } from "./sha256";

const MS_PER_DAY = 86_400_000;

// ---------- numbers ----------
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Parse a money/quantity cell. Strips currency symbols and thousands separators. NaN if invalid. */
export function parseNumber(raw: string): number {
  const s = raw.trim();
  if (s === "") return NaN;
  if (PLAIN_NUMBER.test(s)) return Number(s);
  let t = s;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[^\d.,+-]/g, ""); // currency symbols, spaces (incl. NBSP), letters
  if (t.endsWith("-")) {
    negative = true;
    t = t.slice(0, -1);
  }
  if (t === "" || !/\d/.test(t)) return NaN;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal mark
    t = lastDot > lastComma ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    if (/^[+-]?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
    else if (/^[+-]?\d*,\d{1,2}$/.test(t)) t = t.replace(",", ".");
    else return NaN;
  } else if (lastDot >= 0) {
    if (/^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, "");
  }
  if (!PLAIN_NUMBER.test(t)) return NaN;
  const v = Number(t);
  return negative ? -v : v;
}

// ---------- dates ----------
export type DateOrder = "DMY" | "MDY";

export interface DateOrderDetection {
  order: DateOrder;
  /** true when every day/month pair is <= 12 so the order cannot be inferred */
  ambiguous: boolean;
  /** true when evidence for both orders was found (mixed formats) */
  conflicting: boolean;
}

const SLASH_DATE =
  /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AP]M)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;
const EXCEL_SERIAL = /^\d{4,6}(\.\d+)?$/;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function build(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mi: number,
  ss: number,
  ap: string | undefined,
): number {
  let h = hh;
  if (ap !== undefined) {
    const upper = ap.toUpperCase();
    if (h < 1 || h > 12) return NaN;
    if (upper === "AM" && h === 12) h = 0;
    else if (upper === "PM" && h < 12) h += 12;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return NaN;
  if (h > 23 || mi > 59 || ss > 59) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi, ss);
}

function fullYear(y: number, digits: number): number {
  if (digits >= 4) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/** Excel serial (1900 system) -> epoch ms; NaN if outside a sensible range. */
export function excelSerialToMs(serial: number): number {
  if (!(serial > 20_000 && serial < 80_000)) return NaN; // ~1954 .. ~2119
  return Math.round((serial - 25_569) * MS_PER_DAY);
}

/**
 * Parse one date cell to epoch milliseconds (naive timestamps are read as UTC wall-clock).
 * `order` resolves d/m vs m/d for slash-style dates; ISO (year first) and Excel serials ignore it.
 */
export function parseDateMs(raw: string, order: DateOrder): number {
  const s = raw.trim();
  if (s === "") return NaN;
  const m = SLASH_DATE.exec(s);
  if (m !== null) {
    const a = m[1]!;
    const b = Number(m[2]);
    const c = m[3]!;
    const hh = m[4] === undefined ? 0 : Number(m[4]);
    const mi = m[5] === undefined ? 0 : Number(m[5]);
    const ss = m[6] === undefined ? 0 : Number(m[6]);
    if (a.length === 4) return build(Number(a), b, Number(c), hh, mi, ss, m[7]);
    if (c.length === 4 || c.length === 2) {
      const y = fullYear(Number(c), c.length);
      return order === "DMY"
        ? build(y, b, Number(a), hh, mi, ss, m[7])
        : build(y, Number(a), b, hh, mi, ss, m[7]);
    }
    return NaN;
  }
  if (EXCEL_SERIAL.test(s)) {
    return excelSerialToMs(Number(s));
  }
  // compact ISO such as 20240131 or an ISO string with a named zone: let Date try, but only
  // when the text starts with a 4-digit year to avoid locale-dependent guesses.
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s)) {
    const t = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? NaN : ms;
  }
  return NaN;
}

/** True when a value is a slash-style date whose first/second part decides the d/m order. */
export function detectDateOrder(
  values: readonly string[],
  sampleSize = 20_000,
): DateOrderDetection {
  let firstGt12 = 0; // first part > 12 -> must be the day -> DMY
  let secondGt12 = 0; // second part > 12 -> must be the day -> MDY
  let seen = 0;
  const step = Math.max(1, Math.floor(values.length / sampleSize));
  for (let i = 0; i < values.length && seen < sampleSize; i += step) {
    const v = values[i]!;
    const m = SLASH_DATE.exec(v.trim());
    if (m === null || m[1]!.length === 4) continue;
    seen++;
    if (Number(m[1]) > 12) firstGt12++;
    if (Number(m[2]) > 12) secondGt12++;
  }
  if (firstGt12 === 0 && secondGt12 === 0) {
    return { order: "DMY", ambiguous: seen > 0, conflicting: false };
  }
  if (firstGt12 > 0 && secondGt12 > 0) {
    return { order: firstGt12 >= secondGt12 ? "DMY" : "MDY", ambiguous: false, conflicting: true };
  }
  return { order: firstGt12 > 0 ? "DMY" : "MDY", ambiguous: false, conflicting: false };
}

export function msToDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

export function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function dayToMonth(day: number): string {
  return dayToIso(day).slice(0, 7);
}

export function isoToDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
}

/** Add calendar months to a day number, clamping the day-of-month (30 Jan + 1 month = 28/29 Feb). */
export function addMonthsDay(day: number, months: number): number {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + months;
  const dom = d.getUTCDate();
  const ty = y + Math.floor(mo / 12);
  const tm = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(ty, tm, Math.min(dom, last)) / MS_PER_DAY);
}

// ---------- ids ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MISSING_REFS = new Set(["", "nan", "null", "none", "n/a", "na", "undefined", "-"]);

export function looksLikeEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

/**
 * Normalise a customer ref: trim, numeric "12345.0" -> "12345", email-like -> SHA-256 hash
 * (prefix "h_" + first 16 hex chars). Returns "" for a missing ref. `onEmail` is called when an
 * email was hashed so callers can count them.
 */
export function normalizeCustomerRef(raw: string, onEmail?: () => void): string {
  const t = raw.trim();
  if (MISSING_REFS.has(t.toLowerCase())) return "";
  if (/^\d+\.0+$/.test(t)) return t.replace(/\.0+$/, "");
  if (looksLikeEmail(t)) {
    onEmail?.();
    return `h_${sha256Hex(`customeriq:${t.toLowerCase()}`).slice(0, 16)}`;
  }
  return t;
}
