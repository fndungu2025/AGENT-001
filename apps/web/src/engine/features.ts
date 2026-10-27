/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Per-customer, per-cutoff features (PRD A.3). Only rows/orders dated <= T influence a feature
// block built at T; the label looks forward from T. Hot loops use typed arrays.
import type { CleanData } from "./clean";

export const BASE_FEATURES = [
  "recency_days",
  "frequency",
  "monetary",
  "tenure_days",
  "avg_order_value",
  "avg_interpurchase_days",
  "std_interpurchase_days",
  "recency_ratio",
  "orders_30d",
  "orders_90d",
  "orders_180d",
  "revenue_90d",
  "order_trend",
  "distinct_products",
  "return_rate",
  "is_wholesale",
  "is_single_purchase",
] as const;
export type BaseFeature = (typeof BASE_FEATURES)[number];
export const NB = BASE_FEATURES.length;

const F = {
  recency: 0,
  frequency: 1,
  monetary: 2,
  tenure: 3,
  aov: 4,
  avgIp: 5,
  stdIp: 6,
  ratio: 7,
  o30: 8,
  o90: 9,
  o180: 10,
  rev90: 11,
  trend: 12,
  products: 13,
  returnRate: 14,
  wholesale: 15,
  single: 16,
} as const;
export const FEATURE_INDEX = F;

export interface FeatureBlock {
  /** Cutoff day number */
  T: number;
  n: number;
  /** customer index into CleanData for each row */
  cust: Int32Array;
  /** row-major n x NB */
  X: Float64Array;
  /** label (null when the block is not labelled, e.g. scoring) */
  y: Uint8Array | null;
  /** most frequent country index (history <= T) */
  country: Int32Array;
}

export interface FeatureOptions {
  /** Horizon in days; null builds an unlabelled block. */
  horizon: number | null;
  excludeWholesale: boolean;
}

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function computeFeatures(d: CleanData, T: number, opt: FeatureOptions): FeatureBlock {
  const nCust = d.nCust;
  const Xall = new Float64Array(nCust * NB);
  const custAll = new Int32Array(nCust);
  const countryAll = new Int32Array(nCust);
  const yAll = new Uint8Array(nCust);
  const monAll = new Float64Array(nCust); // net revenue, all history <= T (pence)
  const avgQty = new Float64Array(nCust);
  const hasHistory = new Uint8Array(nCust);
  const prodStamp = new Int32Array(Math.max(1, d.nProducts));
  const cc = new Int32Array(Math.max(1, d.countries.length));
  let stampCounter = 0;
  let n = 0;
  const w365 = T - 365;

  for (let c = 0; c < nCust; c++) {
    // ---- rows <= T ----
    const r0 = d.rowStart[c]!;
    const r1 = d.rowStart[c + 1]!;
    let mon = 0;
    let qtySum = 0;
    let lines = 0;
    let monetary = 0;
    let rev90 = 0;
    let cancelled = 0;
    let grossWin = 0;
    let distinct = 0;
    let bestCo = -1;
    let bestCnt = 0;
    stampCounter++;
    let rEnd = r0;
    for (let r = r0; r < r1; r++) {
      const day = d.rDay[r]!;
      if (day > T) break;
      rEnd = r + 1;
      const rev = d.rRev[r]!;
      mon += rev;
      const co = d.rCountry[r]!;
      const k = ++cc[co]!;
      if (k > bestCnt || (k === bestCnt && co < bestCo)) {
        bestCnt = k;
        bestCo = co;
      }
      const cancel = d.rCancel[r] === 1;
      if (!cancel) {
        qtySum += d.rQty[r]!;
        lines++;
      }
      if (day >= w365) {
        monetary += rev;
        if (day > T - 90) rev90 += rev;
        if (cancel) cancelled += rev;
        else {
          grossWin += rev;
          const p = d.rProd[r]!;
          if (p >= 0 && prodStamp[p] !== stampCounter) {
            prodStamp[p] = stampCounter;
            distinct++;
          }
        }
      }
    }
    for (let r = r0; r < rEnd; r++) cc[d.rCountry[r]!] = 0;
    if (rEnd === r0) continue; // no history at T
    hasHistory[c] = 1;
    monAll[c] = mon;
    avgQty[c] = lines > 0 ? qtySum / lines : 0;

    // ---- orders <= T ----
    const o0 = d.orderStart[c]!;
    const o1 = d.orderStart[c + 1]!;
    let nAll = 0;
    let firstDay = 0;
    let lastDay = 0;
    let freq = 0;
    let o30 = 0;
    let o90 = 0;
    let o180 = 0;
    let oPrev = 0; // (T-180, T-90]
    let gross = 0;
    let gapMean = 0;
    let gapM2 = 0;
    let gapN = 0;
    let o = o0;
    for (; o < o1; o++) {
      const day = d.oDay[o]!;
      if (day > T) break;
      if (nAll === 0) firstDay = day;
      else {
        const gap = day - lastDay;
        gapN++;
        const delta = gap - gapMean;
        gapMean += delta / gapN;
        gapM2 += delta * (gap - gapMean);
      }
      lastDay = day;
      nAll++;
      if (day >= w365) {
        freq++;
        gross += d.oGross[o]!;
      }
      if (day > T - 30) o30++;
      if (day > T - 90) o90++;
      else if (day > T - 180) oPrev++;
      if (day > T - 180) o180++;
    }
    if (freq === 0) continue; // not eligible at T
    let y = 0;
    if (opt.horizon !== null && o < o1 && d.oDay[o]! <= T + opt.horizon) y = 1;

    const recency = T - lastDay;
    const tenure = T - firstDay;
    const avgIp = nAll >= 2 ? (lastDay - firstDay) / (nAll - 1) : tenure;
    const stdIp = nAll >= 3 ? Math.sqrt(gapM2 / (gapN - 1)) : 0;
    const base = n * NB;
    Xall[base + F.recency] = recency;
    Xall[base + F.frequency] = freq;
    Xall[base + F.monetary] = monetary / 100;
    Xall[base + F.tenure] = tenure;
    Xall[base + F.aov] = gross / 100 / freq;
    Xall[base + F.avgIp] = avgIp;
    Xall[base + F.stdIp] = stdIp;
    Xall[base + F.ratio] = recency / Math.max(avgIp, 1);
    Xall[base + F.o30] = o30;
    Xall[base + F.o90] = o90;
    Xall[base + F.o180] = o180;
    Xall[base + F.rev90] = rev90 / 100;
    Xall[base + F.trend] = o90 - oPrev;
    Xall[base + F.products] = distinct;
    Xall[base + F.returnRate] =
      grossWin > 0 ? Math.min(1, Math.max(0, Math.abs(cancelled) / grossWin)) : 0;
    Xall[base + F.single] = nAll === 1 ? 1 : 0;
    custAll[n] = c;
    countryAll[n] = bestCo;
    yAll[n] = y;
    n++;
  }

  // ---- wholesale flag (R8) on data <= T ----
  const flagged = wholesaleFlags(monAll, avgQty, hasHistory);
  let keep = 0;
  const X = new Float64Array(n * NB);
  const cust = new Int32Array(n);
  const country = new Int32Array(n);
  const y = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = custAll[i]!;
    const w = flagged[c]!;
    if (opt.excludeWholesale && w === 1) continue;
    X.set(Xall.subarray(i * NB, i * NB + NB), keep * NB);
    X[keep * NB + F.wholesale] = w;
    cust[keep] = c;
    country[keep] = countryAll[i]!;
    y[keep] = yAll[i]!;
    keep++;
  }
  return {
    T,
    n: keep,
    cust: cust.slice(0, keep),
    X: X.slice(0, keep * NB),
    y: opt.horizon === null ? null : y.slice(0, keep),
    country: country.slice(0, keep),
  };
}

/** R8: net monetary >= p99 of customers with history, or average quantity per sale line > 50. */
export function wholesaleFlags(
  net: Float64Array,
  avgQty: Float64Array,
  hasHistory: Uint8Array,
): Uint8Array {
  const vals: number[] = [];
  for (let c = 0; c < net.length; c++) if (hasHistory[c] === 1) vals.push(net[c]!);
  const sorted = Float64Array.from(vals).sort();
  const p99 = quantileSorted(sorted, 0.99);
  const out = new Uint8Array(net.length);
  for (let c = 0; c < net.length; c++) {
    if (hasHistory[c] !== 1) continue;
    if ((net[c]! >= p99 && net[c]! > 0) || avgQty[c]! > 50) out[c] = 1;
  }
  return out;
}

/** Wholesale flags as of day T (all history <= T); used for the data-quality profile. */
export function wholesaleAt(d: CleanData, T: number): Uint8Array {
  const net = new Float64Array(d.nCust);
  const avgQty = new Float64Array(d.nCust);
  const has = new Uint8Array(d.nCust);
  for (let c = 0; c < d.nCust; c++) {
    let m = 0;
    let q = 0;
    let l = 0;
    let any = false;
    for (let r = d.rowStart[c]!; r < d.rowStart[c + 1]!; r++) {
      if (d.rDay[r]! > T) break;
      any = true;
      m += d.rRev[r]!;
      if (d.rCancel[r] === 0) {
        q += d.rQty[r]!;
        l++;
      }
    }
    if (any) {
      has[c] = 1;
      net[c] = m;
      avgQty[c] = l > 0 ? q / l : 0;
    }
  }
  return wholesaleFlags(net, avgQty, has);
}
