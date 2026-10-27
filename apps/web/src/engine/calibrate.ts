// Probability calibration fit on validation scores (PRD F-08 AC4): isotonic when there are
// >= 1000 validation positives, otherwise sigmoid (Platt scaling).
/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in hot loops */

export interface Calibrator {
  kind: "isotonic" | "sigmoid";
  apply(scores: ArrayLike<number>): Float64Array;
}

const P_MIN = 0.001;
const P_MAX = 0.999;
const clipP = (p: number): number => (p < P_MIN ? P_MIN : p > P_MAX ? P_MAX : p);

export function fitIsotonic(scores: ArrayLike<number>, y: ArrayLike<number>): Calibrator {
  const n = scores.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => scores[a]! - scores[b]! || a - b);
  // merge equal scores into weighted groups, then pool adjacent violators
  const lo: number[] = [];
  const hi: number[] = [];
  const val: number[] = [];
  const wt: number[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    let sum = 0;
    while (j < n && scores[order[j]!]! === scores[order[i]!]!) {
      sum += y[order[j]!]!;
      j++;
    }
    lo.push(scores[order[i]!]!);
    hi.push(scores[order[i]!]!);
    val.push(sum / (j - i));
    wt.push(j - i);
    i = j;
  }
  const bl: number[] = [];
  const bh: number[] = [];
  const bv: number[] = [];
  const bw: number[] = [];
  for (let g = 0; g < lo.length; g++) {
    bl.push(lo[g]!);
    bh.push(hi[g]!);
    bv.push(val[g]!);
    bw.push(wt[g]!);
    while (bv.length > 1 && bv[bv.length - 2]! >= bv[bv.length - 1]!) {
      const k = bv.length - 1;
      const w = bw[k - 1]! + bw[k]!;
      bv[k - 1] = (bv[k - 1]! * bw[k - 1]! + bv[k]! * bw[k]!) / w;
      bw[k - 1] = w;
      bh[k - 1] = bh[k]!;
      bl.pop();
      bh.pop();
      bv.pop();
      bw.pop();
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let b = 0; b < bv.length; b++) {
    xs.push(bl[b]!);
    ys.push(bv[b]!);
    if (bh[b]! > bl[b]!) {
      xs.push(bh[b]!);
      ys.push(bv[b]!);
    }
  }
  return {
    kind: "isotonic",
    apply(s) {
      const out = new Float64Array(s.length);
      for (let q = 0; q < s.length; q++) {
        const x = s[q]!;
        if (xs.length === 0) {
          out[q] = 0.5;
          continue;
        }
        if (x <= xs[0]!) {
          out[q] = clipP(ys[0]!);
          continue;
        }
        if (x >= xs[xs.length - 1]!) {
          out[q] = clipP(ys[ys.length - 1]!);
          continue;
        }
        let a = 0;
        let b = xs.length - 1;
        while (b - a > 1) {
          const mid = (a + b) >> 1;
          if (xs[mid]! <= x) a = mid;
          else b = mid;
        }
        const t = (x - xs[a]!) / (xs[b]! - xs[a]!);
        out[q] = clipP(ys[a]! + t * (ys[b]! - ys[a]!));
      }
      return out;
    },
  };
}

export function fitSigmoid(scores: ArrayLike<number>, y: ArrayLike<number>): Calibrator {
  const n = scores.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += scores[i]!;
  mean /= Math.max(n, 1);
  let v = 0;
  for (let i = 0; i < n; i++) v += (scores[i]! - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(n, 1)) || 1;
  let pos = 0;
  for (let i = 0; i < n; i++) pos += y[i]!;
  const neg = n - pos;
  const tPos = (pos + 1) / (pos + 2);
  const tNeg = 1 / (neg + 2);
  // Newton on (a, b) minimising cross-entropy against Platt-smoothed targets
  let a = 1;
  let b = Math.log((pos + 1) / (neg + 1));
  for (let it = 0; it < 50; it++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 1e-9;
    let h01 = 0;
    let h11 = 1e-9;
    for (let i = 0; i < n; i++) {
      const s = (scores[i]! - mean) / sd;
      const z = a * s + b;
      const p = 1 / (1 + Math.exp(-z));
      const t = y[i] === 1 ? tPos : tNeg;
      const r = p - t;
      g0 += r * s;
      g1 += r;
      const h = p * (1 - p);
      h00 += h * s * s;
      h01 += h * s;
      h11 += h;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-18) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (-h01 * g0 + h00 * g1) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return {
    kind: "sigmoid",
    apply(s) {
      const out = new Float64Array(s.length);
      for (let i = 0; i < s.length; i++) {
        out[i] = clipP(1 / (1 + Math.exp(-(a * ((s[i]! - mean) / sd) + b))));
      }
      return out;
    },
  };
}

export function fitCalibrator(scores: ArrayLike<number>, y: ArrayLike<number>): Calibrator {
  let pos = 0;
  for (let i = 0; i < y.length; i++) pos += y[i]!;
  return pos >= 1000 ? fitIsotonic(scores, y) : fitSigmoid(scores, y);
}
