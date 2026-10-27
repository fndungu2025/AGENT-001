/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Repeat-purchase models (PRD F-08): recency baseline, logistic regression, random forest,
// calibration on validation, selection by validation PR-AUC, final refit and scoring.
import { fitCalibrator } from "./calibrate";
import type { Calibrator } from "./calibrate";
import { BASE_FEATURES, NB } from "./features";
import type { FeatureBlock } from "./features";
import { binMatrix, forestPredict, trainForest } from "./forest";
import type { Forest } from "./forest";
import { fitLogregPath, logregDecision, standardiseRow } from "./logreg";
import type { LogregModel } from "./logreg";
import { bestF1Threshold, buildCurves, computeMetrics, prAucOf } from "./metrics";
import { makeRng, SEED, shuffleInPlace } from "./rng";
import type { ModelName, ModelResult } from "./types";

export const LOGREG_C_GRID = [0.01, 0.1, 1, 10];
export const FOREST_DEPTH_GRID = [6, 10];
export const FOREST_TREES = 120;
export const FOREST_MIN_LEAF = 20;
export const FOREST_MAX_SAMPLES = 40_000;
const LOG_FEATURES = new Set<string>([
  "frequency",
  "monetary",
  "avg_order_value",
  "avg_interpurchase_days",
  "std_interpurchase_days",
  "revenue_90d",
  "distinct_products",
  "recency_ratio",
]);

const LABELS: Record<ModelName, string> = {
  baseline_recency: "Simple recency rule (baseline)",
  logreg: "Logistic regression",
  random_forest: "Random forest",
};

// ---------- design matrix: base features + one-hot country (top 10 + Other) ----------
export interface Design {
  P: number;
  names: string[];
  /** country indices (into CleanData.countries) with their own column, in column order */
  countryTop: number[];
  countryNames: string[];
}

export function makeDesign(
  blocks: FeatureBlock[],
  nCust: number,
  countryNames: string[],
  topN = 10,
): Design {
  const seen = new Uint8Array(nCust);
  const counts = new Float64Array(Math.max(1, countryNames.length));
  for (const b of blocks) {
    for (let i = 0; i < b.n; i++) {
      const c = b.cust[i]!;
      if (seen[c] === 1) continue;
      seen[c] = 1;
      counts[b.country[i]!]!++;
    }
  }
  const order = Array.from({ length: countryNames.length }, (_, i) => i)
    .filter((i) => counts[i]! > 0)
    .sort((a, b) => counts[b]! - counts[a]! || a - b)
    .slice(0, topN);
  return {
    P: NB + order.length + 1,
    names: [...BASE_FEATURES, ...order.map((i) => `country:${countryNames[i]!}`), "country:Other"],
    countryTop: order,
    countryNames,
  };
}

export function designMatrix(dsg: Design, blocks: FeatureBlock[]): Float64Array {
  let n = 0;
  for (const b of blocks) n += b.n;
  const X = new Float64Array(n * dsg.P);
  let row = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.n; i++, row++) {
      const base = row * dsg.P;
      for (let j = 0; j < NB; j++) X[base + j] = b.X[i * NB + j]!;
      const k = dsg.countryTop.indexOf(b.country[i]!);
      X[base + NB + (k >= 0 ? k : dsg.countryTop.length)] = 1;
    }
  }
  return X;
}

export function stackLabels(blocks: FeatureBlock[]): Uint8Array {
  let n = 0;
  for (const b of blocks) n += b.n;
  const y = new Uint8Array(n);
  let o = 0;
  for (const b of blocks) {
    if (b.y === null) throw new Error("labelled block expected");
    y.set(b.y, o);
    o += b.n;
  }
  return y;
}

// ---------- baseline ----------
export interface BaselineModel {
  edges: Float64Array;
  rates: Float64Array;
}

export function fitBaseline(recency: ArrayLike<number>, y: ArrayLike<number>): BaselineModel {
  const n = recency.length;
  const sorted = Float64Array.from(recency).sort();
  const e: number[] = [];
  for (let q = 1; q < 10; q++) {
    const v = sorted[Math.min(n - 1, Math.floor((q * n) / 10))]!;
    if (e.length === 0 || v > e[e.length - 1]!) e.push(v);
  }
  const edges = Float64Array.from(e);
  const pos = new Float64Array(edges.length + 1);
  const cnt = new Float64Array(edges.length + 1);
  for (let i = 0; i < n; i++) {
    const b = baselineBin(edges, recency[i]!);
    cnt[b]!++;
    pos[b]! += y[i]!;
  }
  let overall = 0;
  for (let i = 0; i < n; i++) overall += y[i]!;
  overall /= Math.max(n, 1);
  const rates = new Float64Array(edges.length + 1);
  for (let b = 0; b < rates.length; b++) rates[b] = cnt[b]! > 0 ? pos[b]! / cnt[b]! : overall;
  return { edges, rates };
}

function baselineBin(edges: Float64Array, v: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function predictBaseline(m: BaselineModel, block: FeatureBlock): Float64Array {
  const out = new Float64Array(block.n);
  for (let i = 0; i < block.n; i++) out[i] = m.rates[baselineBin(m.edges, block.X[i * NB]!)]!;
  return out;
}

function recencyOf(blocks: FeatureBlock[]): Float64Array {
  let n = 0;
  for (const b of blocks) n += b.n;
  const r = new Float64Array(n);
  let o = 0;
  for (const b of blocks) for (let i = 0; i < b.n; i++) r[o++] = b.X[i * NB]!;
  return r;
}

// ---------- candidate fits ----------
function logColsFor(dsg: Design): Uint8Array {
  const out = new Uint8Array(dsg.P);
  dsg.names.forEach((nm, j) => {
    if (LOG_FEATURES.has(nm)) out[j] = 1;
  });
  return out;
}

export interface FittedMl {
  name: "logreg" | "random_forest";
  logreg?: LogregModel;
  forest?: Forest;
  raw(X: Float64Array, n: number): Float64Array;
}

function wrapLogreg(m: LogregModel): FittedMl {
  return { name: "logreg", logreg: m, raw: (X, n) => logregDecision(m, X, n) };
}
function wrapForest(f: Forest): FittedMl {
  return { name: "random_forest", forest: f, raw: (X, n) => forestPredict(f, X, n) };
}

function fitForest(X: Float64Array, y: Uint8Array, n: number, P: number, depth: number): Forest {
  const B = binMatrix(X, n, P);
  return trainForest(B, y, {
    nTrees: FOREST_TREES,
    maxDepth: depth,
    minLeaf: FOREST_MIN_LEAF,
    maxSamples: FOREST_MAX_SAMPLES,
    seed: SEED,
  });
}

// ---------- evaluation ----------
export interface EvaluationInput {
  train: FeatureBlock[];
  val: FeatureBlock;
  test: FeatureBlock;
  nCust: number;
  countryNames: string[];
  onStep?: (message: string) => void;
}

export interface Choice {
  logregC: number;
  forestDepth: number;
}

export interface EvaluationOutput {
  models: ModelResult[];
  selected: ModelName;
  flags: string[];
  choice: Choice;
  trainRows: number;
}

function pairs(y: Uint8Array, p: Float64Array, max: number): { p: number; y: 0 | 1 }[] {
  const n = y.length;
  const step = Math.max(1, Math.ceil(n / max));
  const out: { p: number; y: 0 | 1 }[] = [];
  for (let i = 0; i < n; i += step) {
    out.push({ p: Math.round(p[i]! * 10_000) / 10_000, y: y[i] === 1 ? 1 : 0 });
  }
  return out;
}

/** Permutation importance on (a deterministic subset of) the test rows: drop in PR-AUC. */
function permutationImportance(
  fit: FittedMl,
  dsg: Design,
  X: Float64Array,
  y: Uint8Array,
  n: number,
): { feature: string; importance: number }[] {
  const maxN = 5000;
  const step = Math.max(1, Math.floor(n / maxN));
  const idx: number[] = [];
  for (let i = 0; i < n && idx.length < maxN; i += step) idx.push(i);
  const m = idx.length;
  const P = dsg.P;
  const Xs = new Float64Array(m * P);
  const ys = new Uint8Array(m);
  idx.forEach((src, i) => {
    Xs.set(X.subarray(src * P, src * P + P), i * P);
    ys[i] = y[src]!;
  });
  const base = prAucOf(ys, fit.raw(Xs, m));
  const rng = makeRng(SEED + 7);
  const groups: { name: string; cols: number[] }[] = [];
  for (let j = 0; j < NB; j++) groups.push({ name: BASE_FEATURES[j]!, cols: [j] });
  groups.push({ name: "country", cols: Array.from({ length: P - NB }, (_, k) => NB + k) });
  const out: { feature: string; importance: number }[] = [];
  const repeats = 2;
  for (const g of groups) {
    let drop = 0;
    for (let r = 0; r < repeats; r++) {
      const perm = new Int32Array(m);
      for (let i = 0; i < m; i++) perm[i] = i;
      shuffleInPlace(perm, rng);
      const Xp = Xs.slice();
      for (let i = 0; i < m; i++) for (const c of g.cols) Xp[i * P + c] = Xs[perm[i]! * P + c]!;
      drop += base - prAucOf(ys, fit.raw(Xp, m));
    }
    out.push({ feature: g.name, importance: Math.round((drop / repeats) * 10_000) / 10_000 });
  }
  return out.sort((a, b) => b.importance - a.importance);
}

function logregImportance(m: LogregModel, dsg: Design): { feature: string; importance: number }[] {
  const out: { feature: string; importance: number }[] = [];
  for (let j = 0; j < NB; j++) {
    out.push({
      feature: BASE_FEATURES[j]!,
      importance: Math.round(Math.abs(m.coef[j]!) * 10_000) / 10_000,
    });
  }
  let c = 0;
  for (let j = NB; j < dsg.P; j++) c += Math.abs(m.coef[j]!);
  out.push({ feature: "country", importance: Math.round(c * 10_000) / 10_000 });
  return out.sort((a, b) => b.importance - a.importance);
}

interface Assembled {
  result: ModelResult;
  valPr: number;
}

function assemble(
  name: ModelName,
  yVal: Uint8Array,
  yTest: Uint8Array,
  rawVal: Float64Array,
  rawTest: Float64Array,
  probVal: Float64Array,
  probTest: Float64Array,
  importance: { feature: string; importance: number }[],
  hyper: Record<string, string | number>,
): Assembled {
  const thr = bestF1Threshold(yVal, probVal);
  const validation = computeMetrics(yVal, probVal, thr, rawVal);
  const test = computeMetrics(yTest, probTest, thr, rawTest);
  return {
    valPr: validation.prAuc,
    result: {
      name,
      label: LABELS[name],
      validation,
      test,
      curves: buildCurves(yTest, probTest, rawTest),
      importance,
      testScores: pairs(yTest, probTest, 20_000),
      hyperparameters: hyper,
    },
  };
}

export function evaluateModels(inp: EvaluationInput): EvaluationOutput {
  const { train, val, test } = inp;
  const dsg = makeDesign(train, inp.nCust, inp.countryNames);
  const P = dsg.P;
  const Xtr = designMatrix(dsg, train);
  const ytr = stackLabels(train);
  const nTr = ytr.length;
  const Xva = designMatrix(dsg, [val]);
  const Xte = designMatrix(dsg, [test]);
  const yVal = val.y!;
  const yTest = test.y!;

  // baseline
  inp.onStep?.("Fitting the simple recency rule");
  const base = fitBaseline(recencyOf(train), ytr);
  const bVal = predictBaseline(base, val);
  const bTest = predictBaseline(base, test);
  const baselineA = assemble(
    "baseline_recency",
    yVal,
    yTest,
    bVal,
    bTest,
    bVal,
    bTest,
    [{ feature: "recency_days", importance: 1 }],
    { deciles: base.rates.length, fit_on: "training cutoffs", calibrated: "no (empirical rates)" },
  );

  // logistic regression: C tuned on validation PR-AUC (raw ranking)
  inp.onStep?.("Tuning logistic regression");
  const logCols = logColsFor(dsg);
  const path = fitLogregPath(Xtr, ytr, nTr, P, LOGREG_C_GRID, { logCols });
  let bestLr = path[0]!;
  let bestLrPr = -1;
  for (const m of path) {
    const pr = prAucOf(yVal, logregDecision(m, Xva, val.n));
    if (pr > bestLrPr + 1e-12) {
      bestLrPr = pr;
      bestLr = m;
    }
  }
  const lrFit = wrapLogreg(bestLr);
  const lrRawVal = lrFit.raw(Xva, val.n);
  const lrRawTest = lrFit.raw(Xte, test.n);
  const lrCal = fitCalibrator(lrRawVal, yVal);
  const logregA = assemble(
    "logreg",
    yVal,
    yTest,
    lrRawVal,
    lrRawTest,
    lrCal.apply(lrRawVal),
    lrCal.apply(lrRawTest),
    logregImportance(bestLr, dsg),
    {
      C: bestLr.C,
      penalty: "l2",
      class_weight: "balanced",
      solver: "damped Newton (IRLS)",
      converged: bestLr.converged ? "yes" : "no",
      preprocessing:
        "signed log1p on 8 skewed features, standardised on training rows only, clipped at +/-5",
      training_rows_used: Math.min(nTr, 60_000),
      calibration: lrCal.kind,
      importance_basis: "absolute standardised coefficients",
    },
  );

  // random forest: depth tuned on validation PR-AUC (raw ranking)
  inp.onStep?.("Tuning random forest");
  let bestRf: Forest | null = null;
  let bestRfPr = -1;
  let bestDepth = FOREST_DEPTH_GRID[0]!;
  const binned = binMatrix(Xtr, nTr, P);
  for (const depth of FOREST_DEPTH_GRID) {
    const fr = trainForest(binned, ytr, {
      nTrees: FOREST_TREES,
      maxDepth: depth,
      minLeaf: FOREST_MIN_LEAF,
      maxSamples: FOREST_MAX_SAMPLES,
      seed: SEED,
    });
    const pr = prAucOf(yVal, forestPredict(fr, Xva, val.n));
    if (pr > bestRfPr + 1e-12) {
      bestRfPr = pr;
      bestRf = fr;
      bestDepth = depth;
    }
  }
  const rfFit = wrapForest(bestRf!);
  const rfRawVal = rfFit.raw(Xva, val.n);
  const rfRawTest = rfFit.raw(Xte, test.n);
  const rfCal = fitCalibrator(rfRawVal, yVal);
  inp.onStep?.("Measuring feature importance");
  const forestA = assemble(
    "random_forest",
    yVal,
    yTest,
    rfRawVal,
    rfRawTest,
    rfCal.apply(rfRawVal),
    rfCal.apply(rfRawTest),
    permutationImportance(rfFit, dsg, Xte, yTest, test.n),
    {
      n_estimators: FOREST_TREES,
      max_depth: bestDepth,
      min_samples_leaf: FOREST_MIN_LEAF,
      max_features: "sqrt",
      class_weight: "balanced_subsample",
      bootstrap_max_samples: FOREST_MAX_SAMPLES,
      histogram_bins: 32,
      calibration: rfCal.kind,
      importance_basis:
        "permutation importance (drop in PR-AUC on up to 5,000 test rows, 2 repeats)",
      per_customer_driver_method:
        "approximation: probability shift when one feature is set to its training median (not SHAP)",
    },
  );

  // selection: highest validation PR-AUC; ties within 0.005 go to logistic regression
  const bestMl: ModelName = forestA.valPr > logregA.valPr + 0.005 ? "random_forest" : "logreg";
  const gain = Math.max(forestA.valPr, logregA.valPr) - baselineA.valPr;
  const flags: string[] = [];
  let selected: ModelName = bestMl;
  if (gain < 0.01) {
    flags.push("model_gain_low");
    selected = "baseline_recency";
  }
  return {
    models: [baselineA.result, logregA.result, forestA.result],
    selected,
    flags,
    choice: { logregC: bestLr.C, forestDepth: bestDepth },
    trainRows: nTr,
  };
}

// ---------- final refit and scoring ----------
export interface ScoringOutput {
  p: Float64Array;
  /** n x G contributions (G = NB + 1: base features then country); null for the baseline */
  contrib: Float64Array | null;
  G: number;
  calibration: Calibrator["kind"] | "none";
}

export function fitAndScore(
  selected: ModelName,
  choice: Choice,
  fitBlocks: FeatureBlock[],
  calibBlock: FeatureBlock,
  score: FeatureBlock,
  nCust: number,
  countryNames: string[],
): ScoringOutput {
  const G = NB + 1;
  const yFit = stackLabels(fitBlocks);
  if (selected === "baseline_recency") {
    const base = fitBaseline(recencyOf(fitBlocks), yFit);
    return { p: predictBaseline(base, score), contrib: null, G, calibration: "none" };
  }
  const dsg = makeDesign(fitBlocks, nCust, countryNames);
  const P = dsg.P;
  const Xfit = designMatrix(dsg, fitBlocks);
  const Xcal = designMatrix(dsg, [calibBlock]);
  const Xsc = designMatrix(dsg, [score]);
  const n = score.n;
  const contrib = new Float64Array(n * G);
  if (selected === "logreg") {
    const m = fitLogregPath(Xfit, yFit, yFit.length, P, [choice.logregC], {
      logCols: logColsFor(dsg),
    })[0]!;
    const fit = wrapLogreg(m);
    const cal = fitCalibrator(fit.raw(Xcal, calibBlock.n), calibBlock.y!);
    const raw = fit.raw(Xsc, n);
    const z = new Float64Array(P);
    for (let i = 0; i < n; i++) {
      standardiseRow(m, Xsc, i, z);
      for (let j = 0; j < NB; j++) contrib[i * G + j] = m.coef[j]! * z[j]!;
      let cs = 0;
      for (let j = NB; j < P; j++) cs += m.coef[j]! * z[j]!;
      contrib[i * G + NB] = cs;
    }
    return { p: cal.apply(raw), contrib, G, calibration: cal.kind };
  }
  const forest = fitForest(Xfit, yFit, yFit.length, P, choice.forestDepth);
  const fit = wrapForest(forest);
  const cal = fitCalibrator(fit.raw(Xcal, calibBlock.n), calibBlock.y!);
  const raw = fit.raw(Xsc, n);
  // Driver approximation for the forest: shift in the (uncalibrated) forest probability when a
  // feature group is replaced by its training median. Positive = the feature raises the score.
  const median = new Float64Array(P);
  const nFit = yFit.length;
  const col = new Float64Array(nFit);
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < nFit; i++) col[i] = Xfit[i * P + j]!;
    col.sort();
    median[j] = col[Math.floor(nFit / 2)]!;
  }
  const groups: number[][] = [];
  for (let j = 0; j < NB; j++) groups.push([j]);
  groups.push(Array.from({ length: P - NB }, (_, k) => NB + k));
  groups.forEach((cols, g) => {
    const Xm = Xsc.slice();
    for (let i = 0; i < n; i++) for (const c of cols) Xm[i * P + c] = median[c]!;
    const pm = fit.raw(Xm, n);
    for (let i = 0; i < n; i++) contrib[i * G + g] = raw[i]! - pm[i]!;
  });
  return { p: cal.apply(raw), contrib, G, calibration: cal.kind };
}
