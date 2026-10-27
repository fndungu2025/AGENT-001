// Single place for number / currency / percent / date formatting (Intl based).
import type { QualityReport } from "../engine";

const LOCALE = "en-GB";

const int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const dec3 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3, minimumFractionDigits: 3 });
const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? int.format(n) : "–";
}
export function fmtDec(n: number, digits: 1 | 2 | 3 = 2): string {
  if (!Number.isFinite(n)) return "–";
  return (digits === 1 ? dec1 : digits === 2 ? dec2 : dec3).format(n);
}
/** `x` is a share between 0 and 1. */
export function fmtPct(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}
export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** GBP when the data looks UK-based, otherwise plain numbers. */
export function detectCurrency(q: QualityReport): string | null {
  const uk = q.profile.topCountries.find((c) => /united kingdom|^uk$|^gb$|great britain/i.test(c.country));
  return uk && uk.rowsPct >= 0.5 ? "GBP" : null;
}

export interface MoneyFormatter {
  /** Full amount, e.g. £12,345 or 12,345.00 */
  full: (n: number) => string;
  /** Short amount for tiles and axes, e.g. £1.2M */
  short: (n: number) => string;
  currency: string | null;
}

export function makeMoney(currency: string | null): MoneyFormatter {
  if (currency) {
    const full = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    const symbol =
      new Intl.NumberFormat(LOCALE, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? "";
    return {
      currency,
      full: (n) => (Number.isFinite(n) ? full.format(n) : "–"),
      short: (n) => (Number.isFinite(n) ? `${n < 0 ? "-" : ""}${symbol}${compact.format(Math.abs(n))}` : "–"),
    };
  }
  return {
    currency: null,
    full: (n) => (Number.isFinite(n) ? dec2.format(n) : "–"),
    short: (n) => (Number.isFinite(n) ? compact.format(n) : "–"),
  };
}
