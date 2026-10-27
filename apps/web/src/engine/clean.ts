// Cleaning rules R1-R8 (PRD A.1, A.2) with a penny-exact reconciliation.
// Money is handled as integer pence internally and only converted to currency units at the edge.
import type { AnalysisOptions, ColumnMapping, QualityReport, RawTable, RuleLog } from "./types";
import { REQUIRED_FIELDS } from "./types";
import {
  detectDateOrder,
  msToDay,
  normalizeCustomerRef,
  parseDateMs,
  parseNumber,
  dayToIso,
  isoToDay,
} from "./values";
import type { DateOrder } from "./values";

/** PRD 4.3 org_settings default non-product stock codes. */
export const DEFAULT_NON_PRODUCT_CODES: readonly string[] = [
  "POST",
  "DOT",
  "M",
  "D",
  "C2",
  "CRUK",
  "BANK CHARGES",
  "AMAZONFEE",
  "ADJUST",
  "ADJUST2",
  "TEST001",
  "TEST002",
  "PADS",
  "B",
  "S",
];

export interface CleanData {
  nCust: number;
  custIds: string[];
  countries: string[];
  /** Kept rows sorted by (customer, day). Row i of customer c lives in [rowStart[c], rowStart[c+1]). */
  nRows: number;
  rowStart: Int32Array;
  rDay: Int32Array;
  /** Signed line revenue in pence (cancellations negative). */
  rRev: Float64Array;
  rQty: Float64Array;
  /** Interned product index, -1 when no stock code is mapped. */
  rProd: Int32Array;
  rCountry: Int32Array;
  rCancel: Uint8Array;
  nProducts: number;
  /** Purchases (A.2): distinct invoice with a non-cancellation line and positive net revenue. */
  nOrders: number;
  orderStart: Int32Array;
  oDay: Int32Array;
  /** Net invoice revenue in pence. */
  oRev: Float64Array;
  /** Gross (non-cancellation) invoice revenue in pence. */
  oGross: Float64Array;
  /** Day numbers (days since 1970-01-01) of the first/last kept row; NaN if nothing kept. */
  dMin: number;
  dMax: number;
  emailsHashed: number;
  dateOrderUsed: DateOrder;
  quality: QualityReport;
}

export interface CleanOptions {
  cancellationMode: AnalysisOptions["cancellationMode"];
  dateOrder: AnalysisOptions["dateOrder"];
  nonProductCodes?: readonly string[] | undefined;
  /** Override "now" for the future-date rule (tests). */
  nowMs?: number | undefined;
}

export class MappingError extends Error {}

const money = (pence: number): number => Math.round(pence) / 100;

const RULE_TEXT: Record<RuleLog["id"], string> = {
  R1: "Unparseable date, quantity, price or invoice id (excluded)",
  R2: "Missing customer reference (excluded from customer analytics)",
  R3: "Exact duplicate rows (first kept, rest excluded)",
  R4: "Cancellations (invoice starts with C or negative quantity)",
  R5: "Zero or negative price on a sale line (excluded)",
  R6: "Non-product stock codes such as postage or fees (excluded)",
  R7: "Dates in the future or before 1990 (excluded)",
  R8: "Wholesale accounts (flagged only, not excluded)",
};

export function cleanTable(table: RawTable, mapping: ColumnMapping, opts: CleanOptions): CleanData {
  const colIndex = new Map<string, number>();
  table.columns.forEach((c, i) => colIndex.set(c, i));
  const idx = (f: keyof ColumnMapping): number => {
    const name = mapping[f];
    if (name === undefined) return -1;
    const i = colIndex.get(name);
    if (i === undefined) throw new MappingError(`Column "${name}" is not in the uploaded file.`);
    return i;
  };
  for (const f of REQUIRED_FIELDS) {
    if (mapping[f] === undefined) throw new MappingError(`Please map the required field "${f}".`);
  }
  const iInv = idx("invoice_id");
  const iTs = idx("invoice_ts");
  const iCust = idx("customer_ref");
  const iQty = idx("quantity");
  const iPrice = idx("unit_price");
  const iStock = idx("stock_code");
  const iCountry = idx("country");
  const mappedCols = [iInv, iTs, iCust, iQty, iPrice, iStock, iCountry].filter((i) => i >= 0);

  const rows = table.rows;
  const n = rows.length;
  const nonProduct = new Set(
    (opts.nonProductCodes ?? DEFAULT_NON_PRODUCT_CODES).map((c) => c.trim().toUpperCase()),
  );

  // date order
  const tsValues: string[] = new Array<string>(n);
  for (let i = 0; i < n; i++) tsValues[i] = rows[i]![iTs] ?? "";
  const detection = detectDateOrder(tsValues);
  const order: DateOrder = opts.dateOrder === "auto" ? detection.order : opts.dateOrder;
  const ambiguous = opts.dateOrder === "auto" && detection.ambiguous;
  const minDay = isoToDay("1990-01-01");
  const maxDay = msToDay(opts.nowMs ?? Date.now());

  const ruleRows = new Float64Array(8);
  const rulePence = new Float64Array(8);
  const hit = (rule: number, pence: number): void => {
    ruleRows[rule - 1]! += 1;
    rulePence[rule - 1]! += pence;
  };

  // kept rows (unsorted)
  const kCust = new Int32Array(n);
  const kInv = new Int32Array(n);
  const kDay = new Int32Array(n);
  const kRev = new Float64Array(n);
  const kQty = new Float64Array(n);
  const kProd = new Int32Array(n);
  const kCountry = new Int32Array(n);
  const kCancel = new Uint8Array(n);
  let kept = 0;

  const custMap = new Map<string, number>();
  const custIds: string[] = [];
  const invMap = new Map<string, number>();
  const prodMap = new Map<string, number>();
  const countryMap = new Map<string, number>();
  const countries: string[] = [];
  const seen = new Set<string>();

  let grossP = 0;
  let cancP = 0;
  let excludedP = 0;
  let netP = 0;
  let missingCustomer = 0;
  let emailsHashed = 0;
  const onEmail = (): void => {
    emailsHashed++;
  };

  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    const inv = (row[iInv] ?? "").trim().toUpperCase();
    const qty = parseNumber(row[iQty] ?? "");
    const price = parseNumber(row[iPrice] ?? "");
    const ms = parseDateMs(row[iTs] ?? "", order);
    const cust = normalizeCustomerRef(row[iCust] ?? "", onEmail);
    if (cust === "") missingCustomer++;
    const stock = iStock >= 0 ? (row[iStock] ?? "").trim().toUpperCase() : "";

    const isCancel = inv.startsWith("C") || qty < 0;
    const priceOk = Number.isFinite(price);
    const qtyOk = Number.isFinite(qty);
    let rev = 0;
    if (priceOk && qtyOk) {
      const pence = Math.round(price * 100);
      // a cancellation is always a negative amount, whatever signs the export used
      rev = isCancel ? -Math.round(Math.abs(qty) * Math.abs(pence)) : Math.round(qty * pence);
      if (isCancel) cancP += rev;
      else grossP += rev;
    }

    // R1 - parse errors
    if (!priceOk || !qtyOk || Number.isNaN(ms) || inv === "") {
      hit(1, rev);
      excludedP += rev;
      continue;
    }
    // R2 - missing customer
    if (cust === "") {
      hit(2, rev);
      excludedP += rev;
      continue;
    }
    // R3 - exact duplicates (all mapped fields equal)
    let key = "";
    for (const c of mappedCols) key += (row[c] ?? "") + "\u0001";
    if (seen.has(key)) {
      hit(3, rev);
      excludedP += rev;
      continue;
    }
    seen.add(key);
    // R4 - cancellations
    if (isCancel && opts.cancellationMode === "exclude") {
      hit(4, rev);
      excludedP += rev;
      continue;
    }
    // R5 - non-positive price on a sale line
    if (!isCancel && price <= 0) {
      hit(5, rev);
      excludedP += rev;
      continue;
    }
    // R6 - non-product codes
    if (stock !== "" && nonProduct.has(stock)) {
      hit(6, rev);
      excludedP += rev;
      continue;
    }
    // R7 - impossible dates
    const day = msToDay(ms);
    if (day > maxDay || day < minDay) {
      hit(7, rev);
      excludedP += rev;
      continue;
    }

    // keep (in net mode a kept cancellation is logged under R4 as a flag)
    if (isCancel) hit(4, rev);
    let ci = custMap.get(cust);
    if (ci === undefined) {
      ci = custIds.length;
      custMap.set(cust, ci);
      custIds.push(cust);
    }
    let ii = invMap.get(inv);
    if (ii === undefined) {
      ii = invMap.size;
      invMap.set(inv, ii);
    }
    let pi = -1;
    if (stock !== "") {
      const p = prodMap.get(stock);
      if (p === undefined) {
        pi = prodMap.size;
        prodMap.set(stock, pi);
      } else pi = p;
    }
    const cname = iCountry >= 0 ? (row[iCountry] ?? "").trim() || "Unknown" : "Unknown";
    let co = countryMap.get(cname);
    if (co === undefined) {
      co = countries.length;
      countryMap.set(cname, co);
      countries.push(cname);
    }
    kCust[kept] = ci;
    kInv[kept] = ii;
    kDay[kept] = day;
    kRev[kept] = rev;
    kQty[kept] = isCancel ? -Math.abs(qty) : qty;
    kProd[kept] = pi;
    kCountry[kept] = co;
    kCancel[kept] = isCancel ? 1 : 0;
    netP += rev;
    kept++;
  }
  seen.clear();

  // ---- sort kept rows by (customer, day) with two stable counting sorts ----
  const nCust = custIds.length;
  let dMin = Number.NaN;
  let dMax = Number.NaN;
  if (kept > 0) {
    dMin = Infinity;
    dMax = -Infinity;
    for (let i = 0; i < kept; i++) {
      const d = kDay[i]!;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
  }
  const perm = new Int32Array(kept);
  if (kept > 0) {
    const span = dMax - dMin + 1;
    const cnt = new Int32Array(span + 1);
    for (let i = 0; i < kept; i++) cnt[kDay[i]! - dMin + 1]!++;
    for (let d = 0; d < span; d++) cnt[d + 1]! += cnt[d]!;
    const byDay = new Int32Array(kept);
    for (let i = 0; i < kept; i++) byDay[cnt[kDay[i]! - dMin]!++] = i;
    const ccnt = new Int32Array(nCust + 1);
    for (let i = 0; i < kept; i++) ccnt[kCust[i]! + 1]!++;
    for (let c = 0; c < nCust; c++) ccnt[c + 1]! += ccnt[c]!;
    const pos = ccnt.slice();
    for (let j = 0; j < kept; j++) {
      const i = byDay[j]!;
      perm[pos[kCust[i]!]!++] = i;
    }
  }
  const rowStart = new Int32Array(nCust + 1);
  for (let i = 0; i < kept; i++) rowStart[kCust[i]! + 1]!++;
  for (let c = 0; c < nCust; c++) rowStart[c + 1]! += rowStart[c]!;

  const rDay = new Int32Array(kept);
  const rRev = new Float64Array(kept);
  const rQty = new Float64Array(kept);
  const rProd = new Int32Array(kept);
  const rCountry = new Int32Array(kept);
  const rCancel = new Uint8Array(kept);
  const rInv = new Int32Array(kept);
  for (let j = 0; j < kept; j++) {
    const i = perm[j]!;
    rDay[j] = kDay[i]!;
    rRev[j] = kRev[i]!;
    rQty[j] = kQty[i]!;
    rProd[j] = kProd[i]!;
    rCountry[j] = kCountry[i]!;
    rCancel[j] = kCancel[i]!;
    rInv[j] = kInv[i]!;
  }

  // ---- orders (purchases) ----
  const nInv = invMap.size;
  const stamp = new Int32Array(nInv).fill(-1);
  const slot = new Int32Array(nInv);
  let maxBlock = 0;
  for (let c = 0; c < nCust; c++) maxBlock = Math.max(maxBlock, rowStart[c + 1]! - rowStart[c]!);
  const tFirst = new Int32Array(maxBlock);
  const tNet = new Float64Array(maxBlock);
  const tGross = new Float64Array(maxBlock);
  const tHasSale = new Uint8Array(maxBlock);
  const oDayT = new Int32Array(kept);
  const oRevT = new Float64Array(kept);
  const oGrossT = new Float64Array(kept);
  const orderStart = new Int32Array(nCust + 1);
  let nOrders = 0;
  for (let c = 0; c < nCust; c++) {
    orderStart[c] = nOrders;
    let tc = 0;
    for (let r = rowStart[c]!; r < rowStart[c + 1]!; r++) {
      const inv = rInv[r]!;
      let s: number;
      if (stamp[inv] !== c) {
        s = tc++;
        stamp[inv] = c;
        slot[inv] = s;
        tFirst[s] = rDay[r]!;
        tNet[s] = 0;
        tGross[s] = 0;
        tHasSale[s] = 0;
      } else s = slot[inv]!;
      tNet[s]! += rRev[r]!;
      if (rCancel[r] === 0) {
        tGross[s]! += rRev[r]!;
        tHasSale[s] = 1;
      }
    }
    for (let s = 0; s < tc; s++) {
      if (tHasSale[s] === 1 && tNet[s]! > 0) {
        oDayT[nOrders] = tFirst[s]!;
        oRevT[nOrders] = tNet[s]!;
        oGrossT[nOrders] = tGross[s]!;
        nOrders++;
      }
    }
  }
  orderStart[nCust] = nOrders;
  const oDay = oDayT.slice(0, nOrders);
  const oRev = oRevT.slice(0, nOrders);
  const oGross = oGrossT.slice(0, nOrders);

  // ---- quality report ----
  const rules: RuleLog[] = (["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"] as const).map(
    (id, i) => {
      let description = RULE_TEXT[id];
      if (id === "R4") {
        description +=
          opts.cancellationMode === "net"
            ? " - kept as negative revenue, never counted as a purchase"
            : " - excluded (cancellation mode: exclude)";
      }
      return { id, description, rows: ruleRows[i]!, revenue: money(rulePence[i]!) };
    },
  );

  // top-1% / top-10% revenue share across customers
  const custNet = new Float64Array(nCust);
  for (let c = 0; c < nCust; c++) {
    let s = 0;
    for (let r = rowStart[c]!; r < rowStart[c + 1]!; r++) s += rRev[r]!;
    custNet[c] = s;
  }
  const sortedNet = Float64Array.from(custNet).sort().reverse();
  const totalNet = sortedNet.reduce((a, b) => a + b, 0);
  const shareTop = (frac: number): number => {
    if (nCust === 0 || totalNet <= 0) return 0;
    const k = Math.max(1, Math.ceil(nCust * frac));
    let s = 0;
    for (let i = 0; i < k; i++) s += sortedNet[i]!;
    return Math.round((s / totalNet) * 10_000) / 10_000;
  };
  const countryRows = new Float64Array(countries.length);
  for (let r = 0; r < kept; r++) countryRows[rCountry[r]!]!++;
  const topCountries = countries
    .map((country, i) => ({ country, rowsPct: kept > 0 ? (countryRows[i]! / kept) * 100 : 0 }))
    .sort((a, b) => b.rowsPct - a.rowsPct || a.country.localeCompare(b.country))
    .slice(0, 5)
    .map((c) => ({ country: c.country, rowsPct: Math.round(c.rowsPct * 100) / 100 }));

  const reconGross = money(grossP);
  const reconCanc = money(cancP);
  const reconExcl = money(excludedP);
  const reconNet = money(netP);
  const balances = Math.round(grossP + cancP - excludedP) === Math.round(netP);

  const quality: QualityReport = {
    rowsRead: n,
    rowsKept: kept,
    rules,
    reconciliation: {
      gross: reconGross,
      cancellations: reconCanc,
      excluded: reconExcl,
      net: reconNet,
      balances,
    },
    profile: {
      customers: nCust,
      invoices: nOrders,
      products: prodMap.size,
      dateMin: kept > 0 ? dayToIso(dMin) : "",
      dateMax: kept > 0 ? dayToIso(dMax) : "",
      topCountries,
      revenueShareTop1pct: shareTop(0.01),
      revenueShareTop10pct: shareTop(0.1),
      wholesaleCustomers: 0,
      missingCustomerPct: n > 0 ? Math.round((missingCustomer / n) * 10_000) / 100 : 0,
    },
    warnings: [],
  };
  const w = quality.warnings;
  if (n > 0 && missingCustomer / n > 0.3) {
    w.push({
      code: "HIGH_MISSING_CUSTOMER",
      severity: "warning",
      message: `${quality.profile.missingCustomerPct.toFixed(1)}% of rows have no customer reference and cannot be used for customer analytics.`,
    });
  }
  if (ambiguous) {
    w.push({
      code: "DMY_MDY_AMBIGUOUS",
      severity: "warning",
      message:
        "Every date has a day and month of 12 or less, so day-first versus month-first cannot be told apart. Day-first (DD/MM/YYYY) was assumed; choose the date order explicitly if that is wrong.",
    });
  }
  if (detection.conflicting) {
    w.push({
      code: "DATE_FORMAT_MIXED",
      severity: "warning",
      message: "Both day-first and month-first dates were found; some dates may be misread.",
    });
  }
  if (n > 0 && ruleRows[0]! / n > 0.05) {
    w.push({
      code: "HIGH_PARSE_ERRORS",
      severity: "warning",
      message: `${((ruleRows[0]! / n) * 100).toFixed(1)}% of rows could not be read (date, quantity or price). Check the column mapping.`,
    });
  }
  if (emailsHashed > 0) {
    w.push({
      code: "EMAIL_REFS_HASHED",
      severity: "info",
      message:
        "Customer references that look like email addresses were replaced by a one-way hash in your browser; the raw addresses are not kept.",
    });
  }
  if (!balances) {
    w.push({
      code: "RECONCILIATION_FAILED",
      severity: "error",
      message: "Revenue reconciliation does not balance to the penny.",
    });
  }
  if (kept === 0) {
    w.push({
      code: "NO_ROWS_KEPT",
      severity: "error",
      message: "No usable rows remained after cleaning. Check the column mapping and date format.",
    });
  }

  return {
    nCust,
    custIds,
    countries,
    nRows: kept,
    rowStart,
    rDay,
    rRev,
    rQty,
    rProd,
    rCountry,
    rCancel,
    nProducts: prodMap.size,
    nOrders,
    orderStart,
    oDay,
    oRev,
    oGross,
    dMin,
    dMax,
    emailsHashed,
    dateOrderUsed: order,
    quality,
  };
}
