/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Random forest for binary classification: histogram-based trees (32 bins per feature), bootstrap
// samples, sqrt(P) candidate features per split (continuing to further features only when no valid
// split was found), min leaf 20, balanced_subsample class weights, seeded.
// Bootstrap size is capped (maxSamples) so training stays fast on large uploads.
import { makeRng } from "./rng";

export interface Binned {
  n: number;
  P: number;
  nb: number;
  /** column-major bins: bins[f * n + i] */
  bins: Uint8Array;
  /** edges[f][b]: split value, bin b contains x <= edges[f][b] (and > edges[f][b-1]) */
  edges: Float64Array[];
}

export function binMatrix(X: Float64Array, n: number, P: number, nb = 32): Binned {
  const edges: Float64Array[] = [];
  const sampleN = Math.min(n, 20_000);
  const step = n / Math.max(sampleN, 1);
  for (let f = 0; f < P; f++) {
    const s = new Float64Array(sampleN);
    for (let i = 0; i < sampleN; i++) s[i] = X[Math.floor(i * step) * P + f]!;
    s.sort();
    const uniq: number[] = [];
    for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[i - 1]) uniq.push(s[i]!);
    let e: number[];
    if (uniq.length <= nb) e = uniq.slice(0, -1);
    else {
      e = [];
      for (let q = 1; q < nb; q++) {
        const v = uniq[Math.floor((q * uniq.length) / nb)]!;
        if (e.length === 0 || v > e[e.length - 1]!) e.push(v);
      }
      // the largest unique value must not be an edge or the last bin would be empty
    }
    edges.push(Float64Array.from(e));
  }
  const bins = new Uint8Array(n * P);
  for (let f = 0; f < P; f++) {
    const e = edges[f]!;
    for (let i = 0; i < n; i++) {
      const x = X[i * P + f]!;
      let lo = 0;
      let hi = e.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (e[mid]! < x) lo = mid + 1;
        else hi = mid;
      }
      bins[f * n + i] = lo;
    }
  }
  return { n, P, nb, bins, edges };
}

export interface Tree {
  feat: Int32Array; // -1 for leaf
  thr: Float64Array;
  left: Int32Array;
  right: Int32Array;
  value: Float64Array;
}

export interface Forest {
  P: number;
  trees: Tree[];
}

export interface ForestParams {
  nTrees: number;
  maxDepth: number;
  minLeaf: number;
  maxSamples: number;
  seed: number;
}

export function trainForest(B: Binned, y: Uint8Array, prm: ForestParams): Forest {
  const { n, P } = B;
  const rng = makeRng(prm.seed);
  const mtry = Math.max(1, Math.floor(Math.sqrt(P)));
  const m = Math.min(n, prm.maxSamples);
  const trees: Tree[] = [];
  const featOrder = new Int32Array(P);
  const nbMax = 256;
  const h0 = new Float64Array(nbMax);
  const h1 = new Float64Array(nbMax);
  const hc = new Float64Array(nbMax);
  for (let t = 0; t < prm.nTrees; t++) {
    const idx = new Int32Array(m);
    let mPos = 0;
    for (let i = 0; i < m; i++) {
      const r = rng.int(n);
      idx[i] = r;
      mPos += y[r]!;
    }
    const mNeg = m - mPos;
    // balanced_subsample: weights from this bootstrap sample
    const wPos = mPos > 0 ? m / (2 * mPos) : 1;
    const wNeg = mNeg > 0 ? m / (2 * mNeg) : 1;
    const feat: number[] = [];
    const thr: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    const value: number[] = [];
    const newNode = (): number => {
      feat.push(-1);
      thr.push(0);
      left.push(-1);
      right.push(-1);
      value.push(0);
      return feat.length - 1;
    };
    const stack: [number, number, number, number][] = [[newNode(), 0, m, 0]];
    while (stack.length > 0) {
      const [node, lo, hi, depth] = stack.pop()!;
      const cnt = hi - lo;
      let p1 = 0;
      let p0 = 0;
      for (let i = lo; i < hi; i++) {
        if (y[idx[i]!] === 1) p1 += wPos;
        else p0 += wNeg;
      }
      value[node] = p1 + p0 > 0 ? p1 / (p1 + p0) : 0;
      if (depth >= prm.maxDepth || cnt < 2 * prm.minLeaf || p1 === 0 || p0 === 0) continue;
      for (let f = 0; f < P; f++) featOrder[f] = f;
      for (let f = 0; f < P - 1; f++) {
        const j = f + rng.int(P - f);
        const tmp = featOrder[f]!;
        featOrder[f] = featOrder[j]!;
        featOrder[j] = tmp;
      }
      const parentScore = (p1 * p1 + p0 * p0) / (p1 + p0);
      let bestGain = 1e-12;
      let bestF = -1;
      let bestB = -1;
      for (let k = 0; k < P; k++) {
        if (k >= mtry && bestF >= 0) break;
        const f = featOrder[k]!;
        const nbF = B.edges[f]!.length + 1;
        if (nbF < 2) continue;
        h0.fill(0, 0, nbF);
        h1.fill(0, 0, nbF);
        hc.fill(0, 0, nbF);
        const col = f * n;
        for (let i = lo; i < hi; i++) {
          const r = idx[i]!;
          const b = B.bins[col + r]!;
          hc[b]!++;
          if (y[r] === 1) h1[b]! += wPos;
          else h0[b]! += wNeg;
        }
        let c0 = 0;
        let l0 = 0;
        let l1 = 0;
        for (let b = 0; b < nbF - 1; b++) {
          c0 += hc[b]!;
          l0 += h0[b]!;
          l1 += h1[b]!;
          if (hc[b] === 0) continue;
          const cR = cnt - c0;
          if (c0 < prm.minLeaf || cR < prm.minLeaf) continue;
          const r0 = p0 - l0;
          const r1 = p1 - l1;
          const sl = l0 + l1;
          const sr = r0 + r1;
          if (sl <= 0 || sr <= 0) continue;
          const gain = (l1 * l1 + l0 * l0) / sl + (r1 * r1 + r0 * r0) / sr - parentScore;
          if (gain > bestGain) {
            bestGain = gain;
            bestF = f;
            bestB = b;
          }
        }
      }
      if (bestF < 0) continue;
      // partition idx[lo, hi) by the chosen split
      let i = lo;
      let j = hi - 1;
      const col = bestF * n;
      while (i <= j) {
        if (B.bins[col + idx[i]!]! <= bestB) i++;
        else {
          const tmp = idx[i]!;
          idx[i] = idx[j]!;
          idx[j] = tmp;
          j--;
        }
      }
      const l = newNode();
      const r = newNode();
      feat[node] = bestF;
      thr[node] = B.edges[bestF]![bestB]!;
      left[node] = l;
      right[node] = r;
      stack.push([l, lo, i, depth + 1], [r, i, hi, depth + 1]);
    }
    trees.push({
      feat: Int32Array.from(feat),
      thr: Float64Array.from(thr),
      left: Int32Array.from(left),
      right: Int32Array.from(right),
      value: Float64Array.from(value),
    });
  }
  return { P, trees };
}

/** Mean leaf probability over trees for n design rows (raw feature values). */
export function forestPredict(fr: Forest, X: Float64Array, n: number): Float64Array {
  const P = fr.P;
  const out = new Float64Array(n);
  for (const tr of fr.trees) {
    const { feat, thr, left, right, value } = tr;
    for (let i = 0; i < n; i++) {
      let node = 0;
      let f = feat[0]!;
      while (f >= 0) {
        node = X[i * P + f]! <= thr[node]! ? left[node]! : right[node]!;
        f = feat[node]!;
      }
      out[i]! += value[node]!;
    }
  }
  const inv = 1 / Math.max(fr.trees.length, 1);
  for (let i = 0; i < n; i++) out[i]! *= inv;
  return out;
}
