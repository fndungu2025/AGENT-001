/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
import { describe, expect, it } from "vitest";
import { fitIsotonic, fitSigmoid } from "./calibrate";
import { adjustedRandIndex, chooseK } from "./kmeans";
import {
  brier,
  capturedInTop,
  computeMetrics,
  logLoss,
  prAucOf,
  rankCurve,
  rocAucOf,
} from "./metrics";
import { makeRng } from "./rng";
import { computeRfm, quintileScores, segmentFor, SEGMENT_ORDER } from "./rfm";
import { sha256Hex } from "./sha256";
import { fitLogregPath, logregDecision } from "./logreg";
import { binMatrix, forestPredict, trainForest } from "./forest";

describe("metrics", () => {
  it("ROC-AUC is 1 for a perfect ranking, 0 for reversed, 0.5 for constant and for random", () => {
    const y = [0, 0, 0, 1, 1, 1];
    expect(rocAucOf(y, [0.1, 0.2, 0.3, 0.7, 0.8, 0.9])).toBe(1);
    expect(rocAucOf(y, [0.9, 0.8, 0.7, 0.3, 0.2, 0.1])).toBe(0);
    expect(rocAucOf(y, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5])).toBe(0.5);
    const rng = makeRng(1);
    const yr = Array.from({ length: 4000 }, () => (rng.next() < 0.4 ? 1 : 0));
    const sr = Array.from({ length: 4000 }, () => rng.next());
    expect(Math.abs(rocAucOf(yr, sr) - 0.5)).toBeLessThan(0.03);
  });

  it("matches hand-computed AUC, average precision, Brier and log loss", () => {
    const y = [1, 0, 1, 0];
    const s = [0.9, 0.8, 0.7, 0.1];
    expect(rocAucOf(y, s)).toBeCloseTo(0.75, 12);
    expect(prAucOf(y, s)).toBeCloseTo(0.5 + 0.5 * (2 / 3), 12);
    expect(brier([1, 0], [0.8, 0.3])).toBeCloseTo(0.065, 12);
    expect(logLoss([1, 0], [0.8, 0.3])).toBeCloseTo((-Math.log(0.8) - Math.log(0.7)) / 2, 12);
    expect(prAucOf([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1])).toBe(1);
  });

  it("handles ties as groups (constant score gives AP equal to the base rate)", () => {
    expect(prAucOf([1, 0, 0, 0], [0.5, 0.5, 0.5, 0.5])).toBeCloseTo(0.25, 12);
  });

  it("computes lift and capture, splitting tie groups pro rata", () => {
    const y = Array.from({ length: 10 }, (_, i) => (i < 3 ? 1 : 0));
    const perfect = y.map((v) => v + 0.1 * (v === 1 ? 1 : 0));
    const m = computeMetrics(y, perfect, 0.5);
    expect(m.liftTop10).toBeCloseTo(1 / 1 / 0.3, 9);
    expect(m.captureTop20).toBeCloseTo(2 / 3, 9);
    expect(capturedInTop(rankCurve([1, 0, 0, 0], [1, 1, 1, 1]), 2)).toBeCloseTo(0.5, 12);
  });

  it("thresholded metrics are consistent", () => {
    const m = computeMetrics([1, 1, 0, 0], [0.9, 0.4, 0.6, 0.1], 0.5);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.5);
    expect(m.f1).toBe(0.5);
    expect(m.accuracy).toBe(0.5);
  });
});

describe("calibration", () => {
  it("isotonic output is monotone and sigmoid recovers a logistic relation", () => {
    const rng = makeRng(3);
    const s: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 3000; i++) {
      const x = rng.normal();
      s.push(x);
      y.push(rng.next() < 1 / (1 + Math.exp(-2 * x)) ? 1 : 0);
    }
    const iso = fitIsotonic(s, y).apply([-3, -1, 0, 1, 3]);
    for (let i = 1; i < iso.length; i++) expect(iso[i]!).toBeGreaterThanOrEqual(iso[i - 1]!);
    const sig = fitSigmoid(s, y).apply([0]);
    expect(sig[0]!).toBeGreaterThan(0.4);
    expect(sig[0]!).toBeLessThan(0.6);
    expect(fitSigmoid(s, y).apply([2])[0]!).toBeGreaterThan(0.9);
  });
});

describe("learners", () => {
  function data(n: number, seed: number) {
    const rng = makeRng(seed);
    const P = 4;
    const X = new Float64Array(n * P);
    const y = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < P; j++) X[i * P + j] = rng.normal();
      const z = 1.5 * X[i * P]! - 1 * X[i * P + 1]!;
      y[i] = rng.next() < 1 / (1 + Math.exp(-z)) ? 1 : 0;
    }
    return { X, y, P, n };
  }

  it("logistic regression converges and ranks well", () => {
    const tr = data(4000, 5);
    const te = data(2000, 6);
    const [m] = fitLogregPath(tr.X, tr.y, tr.n, tr.P, [1], { logCols: new Uint8Array(4) });
    expect(m!.converged).toBe(true);
    expect(m!.coef[0]!).toBeGreaterThan(0.8);
    expect(m!.coef[1]!).toBeLessThan(-0.5);
    expect(rocAucOf(te.y, logregDecision(m!, te.X, te.n))).toBeGreaterThan(0.75);
  });

  it("random forest learns the signal and is deterministic", () => {
    const tr = data(4000, 7);
    const te = data(2000, 8);
    const fit = () =>
      trainForest(binMatrix(tr.X, tr.n, tr.P), tr.y, {
        nTrees: 40,
        maxDepth: 6,
        minLeaf: 20,
        maxSamples: 4000,
        seed: 42,
      });
    const a = forestPredict(fit(), te.X, te.n);
    const b = forestPredict(fit(), te.X, te.n);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(rocAucOf(te.y, a)).toBeGreaterThan(0.75);
  });
});

describe("RFM", () => {
  it("quintiles are equal-sized with rank-first ties and recency reversed", () => {
    const values = Array.from({ length: 100 }, (_, i) => i % 3); // many ties
    const q = quintileScores(values, false);
    for (let k = 1; k <= 5; k++) expect(Array.from(q).filter((v) => v === k).length).toBe(20);
    const rec = Array.from({ length: 10 }, (_, i) => i); // smaller recency = better
    expect(Array.from(quintileScores(rec, true))).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  });

  it("evaluates the segment map top to bottom", () => {
    expect(segmentFor(5, 5, 5)).toBe("champions");
    expect(segmentFor(1, 5, 5)).toBe("cant_lose");
    expect(segmentFor(3, 4, 1)).toBe("loyal");
    expect(segmentFor(5, 1, 5)).toBe("high_value_infrequent");
    expect(segmentFor(1, 3, 1)).toBe("at_risk");
    expect(segmentFor(5, 1, 1)).toBe("new_promising");
    expect(segmentFor(3, 2, 2)).toBe("needs_attention");
    expect(segmentFor(1, 1, 1)).toBe("inactive");
  });

  it("assigns every customer exactly one of the eight segments", () => {
    const rng = makeRng(9);
    const n = 500;
    const r = computeRfm({
      recency: Array.from({ length: n }, () => rng.int(365)),
      frequency: Array.from({ length: n }, () => 1 + rng.int(20)),
      monetary: Array.from({ length: n }, () => rng.next() * 1000),
    });
    expect(r.segment).toHaveLength(n);
    for (const s of r.segment) expect(SEGMENT_ORDER).toContain(s);
  });
});

describe("k-means", () => {
  it("recovers three well-separated blobs (ARI = 1)", () => {
    const rng = makeRng(11);
    const centers = [
      [0, 0, 0],
      [8, 8, 0],
      [0, 8, 8],
    ];
    const n = 300;
    const X = new Float64Array(n * 3);
    const truth: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = i % 3;
      truth.push(c);
      for (let j = 0; j < 3; j++) X[i * 3 + j] = centers[c]![j]! + 0.4 * rng.normal();
    }
    const choice = chooseK(X, n, 3)!;
    expect(choice.fit.k).toBe(3);
    expect(choice.silhouette).toBeGreaterThan(0.7);
    expect(adjustedRandIndex(truth, Array.from(choice.fit.labels))).toBeCloseTo(1, 9);
    expect(choice.tried.map((t) => t.k)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("ARI is 0-ish for unrelated labelings and 1 for identical ones", () => {
    expect(adjustedRandIndex([0, 0, 1, 1], [5, 5, 7, 7])).toBe(1);
    const rng = makeRng(2);
    const a = Array.from({ length: 2000 }, () => rng.int(4));
    const b = Array.from({ length: 2000 }, () => rng.int(4));
    expect(Math.abs(adjustedRandIndex(a, b))).toBeLessThan(0.02);
  });
});

describe("sha256", () => {
  it("matches known test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
