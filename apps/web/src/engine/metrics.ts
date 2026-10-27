// Evaluation metrics and curves (PRD F-09): ROC-AUC, PR-AUC (average precision), Brier,
// log loss, thresholded precision/recall/F1/accuracy, lift and capture. Ties in scores are
// handled as groups, so a constant score gives AUC 0.5 and no accidental ordering advantage.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in hot loops */
import type { ModelMetrics } from "./types";

export interface RankCurve {
  P: number;
  N: number;
  /** cumulative positives/negatives after each tie group, in descending score order */
  tp: Float64Array;
  fp: Float64Array;
  /** score value of each group (descending) */
  score: Float64Array;
  /** group sizes */
  size: Float64Array;
}

export function rankCurve(y: ArrayLike<number>, s: ArrayLike<number>): RankCurve {
  const n = y.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => s[b]! - s[a]! || a - b);
  const tp: number[] = [];
  const fp: number[] = [];
  const score: number[] = [];
  const size: number[] = [];
  let t = 0;
  let f = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const idx = order[i]!;
    if (y[idx] === 1) t++;
    else f++;
    const last = i === n - 1 || s[order[i + 1]!]! !== s[idx]!;
    if (last) {
      tp.push(t);
      fp.push(f);
      score.push(s[idx]!);
      size.push(i + 1 - start);
      start = i + 1;
    }
  }
  return {
    P: t,
    N: f,
    tp: Float64Array.from(tp),
    fp: Float64Array.from(fp),
    score: Float64Array.from(score),
    size: Float64Array.from(size),
  };
}

export function rocAuc(rc: RankCurve): number {
  if (rc.P === 0 || rc.N === 0) return 0.5;
  let area = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < rc.tp.length; i++) {
    const x = rc.fp[i]! / rc.N;
    const yv = rc.tp[i]! / rc.P;
    area += (x - px) * (yv + py) * 0.5;
    px = x;
    py = yv;
  }
  return area;
}

/** Average precision, as in scikit-learn's average_precision_score. */
export function prAuc(rc: RankCurve): number {
  if (rc.P === 0) return 0;
  let ap = 0;
  let prevRecall = 0;
  for (let i = 0; i < rc.tp.length; i++) {
    const recall = rc.tp[i]! / rc.P;
    const precision = rc.tp[i]! / (rc.tp[i]! + rc.fp[i]!);
    ap += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return ap;
}

export function rocAucOf(y: ArrayLike<number>, s: ArrayLike<number>): number {
  return rocAuc(rankCurve(y, s));
}
export function prAucOf(y: ArrayLike<number>, s: ArrayLike<number>): number {
  return prAuc(rankCurve(y, s));
}

export function brier(y: ArrayLike<number>, p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const d = p[i]! - y[i]!;
    s += d * d;
  }
  return y.length > 0 ? s / y.length : 0;
}

export function logLoss(y: ArrayLike<number>, p: ArrayLike<number>): number {
  let s = 0;
  const eps = 1e-15;
  for (let i = 0; i < y.length; i++) {
    const q = Math.min(1 - eps, Math.max(eps, p[i]!));
    s += y[i] === 1 ? -Math.log(q) : -Math.log(1 - q);
  }
  return y.length > 0 ? s / y.length : 0;
}

/** Score threshold maximising F1 on the given data (predict positive when p >= threshold). */
export function bestF1Threshold(y: ArrayLike<number>, p: ArrayLike<number>): number {
  const rc = rankCurve(y, p);
  let best = -1;
  let thr = 0.5;
  for (let i = 0; i < rc.tp.length; i++) {
    const tp = rc.tp[i]!;
    const fp = rc.fp[i]!;
    const fn = rc.P - tp;
    const f1 = tp + fp + fn > 0 ? (2 * tp) / (2 * tp + fp + fn) : 0;
    if (f1 > best) {
      best = f1;
      thr = rc.score[i]!;
    }
  }
  return thr;
}

/** Positives captured within the top `k` rows by score; a tie group straddling k counts pro rata. */
export function capturedInTop(rc: RankCurve, k: number): number {
  let taken = 0;
  let pos = 0;
  let prevTp = 0;
  for (let i = 0; i < rc.tp.length; i++) {
    const gsize = rc.size[i]!;
    const gpos = rc.tp[i]! - prevTp;
    if (taken + gsize <= k) {
      taken += gsize;
      pos += gpos;
    } else {
      pos += (gpos * (k - taken)) / gsize;
      break;
    }
    prevTp = rc.tp[i]!;
  }
  return pos;
}

export function computeMetrics(
  y: ArrayLike<number>,
  prob: ArrayLike<number>,
  threshold: number,
  rankScore?: ArrayLike<number>,
): ModelMetrics {
  const n = y.length;
  const rc = rankCurve(y, rankScore ?? prob);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < n; i++) {
    const pred = prob[i]! >= threshold;
    if (pred && y[i] === 1) tp++;
    else if (pred) fp++;
    else if (y[i] === 1) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const baseRate = n > 0 ? rc.P / n : 0;
  const k10 = Math.max(1, Math.ceil(0.1 * n));
  const k20 = Math.max(1, Math.ceil(0.2 * n));
  const lift = baseRate > 0 ? capturedInTop(rc, k10) / k10 / baseRate : 0;
  const capture = rc.P > 0 ? capturedInTop(rc, k20) / rc.P : 0;
  return {
    nRows: n,
    nPositive: rc.P,
    baseRate,
    rocAuc: rocAuc(rc),
    prAuc: prAuc(rc),
    brier: brier(y, prob),
    logLoss: logLoss(y, prob),
    threshold,
    precision,
    recall,
    f1,
    accuracy: n > 0 ? (tp + tn) / n : 0,
    liftTop10: lift,
    captureTop20: capture,
  };
}

export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]!);
  return out;
}

const r4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export interface Curves {
  roc: [number, number][];
  pr: [number, number][];
  calibration: { predicted: number; observed: number; n: number }[];
  gain: [number, number][];
}

export function buildCurves(
  y: ArrayLike<number>,
  prob: ArrayLike<number>,
  rankScore?: ArrayLike<number>,
): Curves {
  const n = y.length;
  const rc = rankCurve(y, rankScore ?? prob);
  const roc: [number, number][] = [[0, 0]];
  const pr: [number, number][] = [];
  const gain: [number, number][] = [[0, 0]];
  let cum = 0;
  for (let i = 0; i < rc.tp.length; i++) {
    cum += rc.size[i]!;
    const fpr = rc.N > 0 ? rc.fp[i]! / rc.N : 0;
    const tpr = rc.P > 0 ? rc.tp[i]! / rc.P : 0;
    roc.push([r4(fpr), r4(tpr)]);
    pr.push([r4(tpr), r4(rc.tp[i]! / (rc.tp[i]! + rc.fp[i]!))]);
    gain.push([r4(cum / n), r4(tpr)]);
  }
  // calibration: 10 equal-count bins by probability
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => prob[a]! - prob[b]! || a - b);
  const bins = Math.min(10, Math.max(1, Math.floor(n / 20)));
  const calibration: Curves["calibration"] = [];
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor((b * n) / bins);
    const hi = Math.floor(((b + 1) * n) / bins);
    let sp = 0;
    let sy = 0;
    for (let i = lo; i < hi; i++) {
      sp += prob[order[i]!]!;
      sy += y[order[i]!]!;
    }
    const m = hi - lo;
    if (m > 0) calibration.push({ predicted: r4(sp / m), observed: r4(sy / m), n: m });
  }
  return {
    roc: downsample(roc, 200),
    pr: downsample(pr, 200),
    calibration,
    gain: downsample(gain, 200),
  };
}
