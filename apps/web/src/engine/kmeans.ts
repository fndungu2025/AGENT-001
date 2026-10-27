// K-means behavioural clustering on log1p(R, F, M), standardised (PRD F-07). Seeded.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in hot loops */
import { makeRng, SEED } from "./rng";
import type { Rng } from "./rng";

export interface KmeansFit {
  k: number;
  labels: Int32Array;
  centroids: Float64Array; // k x dim
  inertia: number;
}

function sqDist(X: Float64Array, i: number, C: Float64Array, c: number, dim: number): number {
  let s = 0;
  for (let j = 0; j < dim; j++) {
    const d = X[i * dim + j]! - C[c * dim + j]!;
    s += d * d;
  }
  return s;
}

function initPlusPlus(X: Float64Array, n: number, dim: number, k: number, rng: Rng): Float64Array {
  const C = new Float64Array(k * dim);
  const first = rng.int(n);
  for (let j = 0; j < dim; j++) C[j] = X[first * dim + j]!;
  const best = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = sqDist(X, i, C, c - 1, dim);
      if (d < best[i]!) best[i] = d;
      total += best[i]!;
    }
    let target = rng.next() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      target -= best[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    for (let j = 0; j < dim; j++) C[c * dim + j] = X[pick * dim + j]!;
  }
  return C;
}

function lloyd(X: Float64Array, n: number, dim: number, k: number, rng: Rng): KmeansFit {
  const C = initPlusPlus(X, n, dim, k, rng);
  const labels = new Int32Array(n).fill(-1);
  const counts = new Float64Array(k);
  const sums = new Float64Array(k * dim);
  let inertia = 0;
  for (let iter = 0; iter < 100; iter++) {
    let changed = 0;
    inertia = 0;
    counts.fill(0);
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      let bc = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(X, i, C, c, dim);
        if (d < bd) {
          bd = d;
          bc = c;
        }
      }
      if (labels[i] !== bc) changed++;
      labels[i] = bc;
      inertia += bd;
      counts[bc]!++;
      for (let j = 0; j < dim; j++) sums[bc * dim + j]! += X[i * dim + j]!;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c]! > 0)
        for (let j = 0; j < dim; j++) C[c * dim + j] = sums[c * dim + j]! / counts[c]!;
    }
    if (changed === 0) break;
  }
  return { k, labels, centroids: C, inertia };
}

/** Best of `nInit` seeded restarts (lowest inertia), like sklearn's n_init. */
export function kmeans(X: Float64Array, n: number, dim: number, k: number, nInit = 10): KmeansFit {
  let best: KmeansFit | null = null;
  for (let t = 0; t < nInit; t++) {
    const fit = lloyd(X, n, dim, k, makeRng(SEED + t * 1009 + k));
    if (best === null || fit.inertia < best.inertia) best = fit;
  }
  return best!;
}

/** Mean silhouette on a deterministic sample of at most `maxN` points. */
export function silhouette(
  X: Float64Array,
  labels: Int32Array,
  n: number,
  dim: number,
  k: number,
  maxN = 5000,
): number {
  let idx: Int32Array;
  if (n <= maxN) {
    idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
  } else {
    const rng = makeRng(SEED);
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    for (let i = 0; i < maxN; i++) {
      const j = i + rng.int(n - i);
      const t = all[i]!;
      all[i] = all[j]!;
      all[j] = t;
    }
    idx = all.slice(0, maxN);
  }
  const m = idx.length;
  const sizes = new Float64Array(k);
  for (let a = 0; a < m; a++) sizes[labels[idx[a]!]!]!++;
  const sumD = new Float64Array(k);
  let total = 0;
  let counted = 0;
  for (let a = 0; a < m; a++) {
    sumD.fill(0);
    const ia = idx[a]!;
    for (let b = 0; b < m; b++) {
      if (a === b) continue;
      const ib = idx[b]!;
      let s = 0;
      for (let j = 0; j < dim; j++) {
        const d = X[ia * dim + j]! - X[ib * dim + j]!;
        s += d * d;
      }
      sumD[labels[ib]!]! += Math.sqrt(s);
    }
    const own = labels[ia]!;
    if (sizes[own]! <= 1) continue; // silhouette 0 for singletons
    const aa = sumD[own]! / (sizes[own]! - 1);
    let bb = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || sizes[c]! === 0) continue;
      bb = Math.min(bb, sumD[c]! / sizes[c]!);
    }
    if (!Number.isFinite(bb)) continue;
    total += (bb - aa) / Math.max(aa, bb, 1e-12);
    counted++;
  }
  return counted > 0 ? total / counted : 0;
}

/** Adjusted Rand index between two labelings given as small non-negative integers. */
export function adjustedRandIndex(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  const table = new Map<number, number>();
  const ra = new Map<number, number>();
  const rb = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    table.set(x * 100_000 + y, (table.get(x * 100_000 + y) ?? 0) + 1);
    ra.set(x, (ra.get(x) ?? 0) + 1);
    rb.set(y, (rb.get(y) ?? 0) + 1);
  }
  const c2 = (v: number): number => (v * (v - 1)) / 2;
  let sumIj = 0;
  for (const v of table.values()) sumIj += c2(v);
  let sumA = 0;
  for (const v of ra.values()) sumA += c2(v);
  let sumB = 0;
  for (const v of rb.values()) sumB += c2(v);
  const expected = (sumA * sumB) / c2(n);
  const maxIdx = (sumA + sumB) / 2;
  if (maxIdx === expected) return 1;
  return (sumIj - expected) / (maxIdx - expected);
}

export interface KmeansChoice {
  fit: KmeansFit;
  tried: { k: number; inertia: number; silhouette: number }[];
  silhouette: number;
  /** true when no k satisfied the 2% minimum-cluster-size rule */
  smallClusterFallback: boolean;
}

export function chooseK(X: Float64Array, n: number, dim: number): KmeansChoice | null {
  const kMax = Math.min(8, Math.floor(n / 2));
  if (n < 6 || kMax < 3) return null;
  const tried: KmeansChoice["tried"] = [];
  let best: { fit: KmeansFit; sil: number } | null = null;
  let fallback: { fit: KmeansFit; sil: number } | null = null;
  for (let k = 3; k <= kMax; k++) {
    const fit = kmeans(X, n, dim, k);
    const sil = silhouette(X, fit.labels, n, dim, k);
    tried.push({ k, inertia: fit.inertia, silhouette: sil });
    const sizes = new Float64Array(k);
    for (let i = 0; i < n; i++) sizes[fit.labels[i]!]!++;
    const minFrac = Math.min(...sizes) / n;
    if (fallback === null || sil > fallback.sil) fallback = { fit, sil };
    if (minFrac >= 0.02 && (best === null || sil > best.sil)) best = { fit, sil };
  }
  const chosen = best ?? fallback!;
  return {
    fit: chosen.fit,
    tried,
    silhouette: chosen.sil,
    smallClusterFallback: best === null,
  };
}
