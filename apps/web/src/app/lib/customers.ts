// Filtering and sorting of the customer list (pure functions, tested).
import type { CustomerRow, RiskBand, SegmentKey } from "../../engine";

export type SortKey =
  | "id"
  | "pRepeat"
  | "segment"
  | "rfm"
  | "lastOrder"
  | "monetary"
  | "frequency"
  | "recencyDays"
  | "expectedValue"
  | "country";

export interface CustomerFilters {
  query: string;
  segment: SegmentKey | "all";
  band: RiskBand | "all";
  country: string;
  wholesale: "any" | "yes" | "no";
  minP: number;
}

export const NO_FILTERS: CustomerFilters = {
  query: "",
  segment: "all",
  band: "all",
  country: "all",
  wholesale: "any",
  minP: 0,
};

export function filterCustomers(customers: CustomerRow[], f: CustomerFilters): CustomerRow[] {
  const q = f.query.trim().toLowerCase();
  return customers.filter((c) => {
    if (q && !c.id.toLowerCase().includes(q)) return false;
    if (f.segment !== "all" && c.segment !== f.segment) return false;
    if (f.band !== "all" && c.riskBand !== f.band) return false;
    if (f.country !== "all" && c.country !== f.country) return false;
    if (f.wholesale === "yes" && !c.isWholesale) return false;
    if (f.wholesale === "no" && c.isWholesale) return false;
    if (c.pRepeat < f.minP) return false;
    return true;
  });
}

function value(c: CustomerRow, key: SortKey): string | number {
  switch (key) {
    case "id":
      return c.id;
    case "pRepeat":
      return c.pRepeat;
    case "segment":
      return c.segment;
    case "rfm":
      return c.rfm.score;
    case "lastOrder":
      return c.lastOrder;
    case "monetary":
      return c.monetary;
    case "frequency":
      return c.frequency;
    case "recencyDays":
      return c.recencyDays;
    case "expectedValue":
      return c.expectedValue;
    case "country":
      return c.country;
  }
}

export function sortCustomers(rows: CustomerRow[], key: SortKey, dir: "asc" | "desc"): CustomerRow[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, key);
    const vb = value(b, key);
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "en", { numeric: true });
    return cmp !== 0 ? cmp * m : a.id.localeCompare(b.id, "en", { numeric: true });
  });
}
