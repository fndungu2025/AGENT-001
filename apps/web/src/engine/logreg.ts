// L2-regularised logistic regression with balanced class weights, fit by damped Newton (IRLS).
// Objective (scikit-learn form): 0.5*||beta||^2 + C * sum_i w_i * logloss_i, intercept unpenalised.
// The scaler (and the signed-log1p transform of skewed columns) is fit on the training rows only.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in hot loops */

export interface LogregModel {
  P: number;
  /** columns that get signed log1p before standardising */
  logCols: Uint8Array;
  mean: Float64Array;
  sd: Float64Array;
  coef: Float64Array;
  intercept: number;
  C: number;
  iterations: number;
  converged: boolean;
}

const Z_CLIP = 5;

function slog(v: number): number {
  return v >= 0 ? Math.log1p(v) : -Math.log1p(-v);
}

/** Transform + standardise one design row into `out` (length P). */
export function standardiseRow(
  m: LogregModel,
  X: Float64Array,
  i: number,
  out: Float64Array,
): void {
  const P = m.P;
  for (let j = 0; j < P; j++) {
    let v = X[i * P + j]!;
    if (m.logCols[j] === 1) v = slog(v);
    let z = (v - m.mean[j]!) / m.sd[j]!;
    if (z > Z_CLIP) z = Z_CLIP;
    else if (z < -Z_CLIP) z = -Z_CLIP;
    out[j] = z;
  }
}

function standardiseAll(m: LogregModel, X: Float64Array, n: number): Float64Array {
  const Z = new Float64Array(n * m.P);
  const row = new Float64Array(m.P);
  for (let i = 0; i < n; i++) {
    standardiseRow(m, X, i, row);
    Z.set(row, i * m.P);
  }
  return Z;
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Solve A x = b for symmetric positive-definite A (n x n, row-major) by Cholesky; returns null if not SPD. */
function cholSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j]!;
      for (let k = 0; k < j; k++) s -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i * n + i] = Math.sqrt(s);
      } else L[i * n + j] = s / L[j * n + j]!;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * n + k]! * y[k]!;
    y[i] = s / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k * n + i]! * x[k]!;
    x[i] = s / L[i * n + i]!;
  }
  return x;
}

export interface LogregFitOptions {
  logCols: Uint8Array;
  maxRows?: number;
}

export interface LogregScaler {
  logCols: Uint8Array;
  mean: Float64Array;
  sd: Float64Array;
}

export function fitScaler(
  X: Float64Array,
  n: number,
  P: number,
  logCols: Uint8Array,
): LogregScaler {
  const mean = new Float64Array(P);
  const sd = new Float64Array(P);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < P; j++) {
      const v = X[i * P + j]!;
      mean[j]! += logCols[j] === 1 ? slog(v) : v;
    }
  }
  for (let j = 0; j < P; j++) mean[j]! /= Math.max(n, 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < P; j++) {
      const v = X[i * P + j]!;
      const d = (logCols[j] === 1 ? slog(v) : v) - mean[j]!;
      sd[j]! += d * d;
    }
  }
  for (let j = 0; j < P; j++) {
    const s = Math.sqrt(sd[j]! / Math.max(n, 1));
    sd[j] = s > 1e-9 ? s : 1;
  }
  return { logCols, mean, sd };
}

/**
 * Fit for several C values (ascending), warm-starting each from the previous solution.
 * The scaler is fit on the supplied training rows only.
 */
export function fitLogregPath(
  X: Float64Array,
  y: Uint8Array,
  n: number,
  P: number,
  Cs: number[],
  opts: LogregFitOptions,
): LogregModel[] {
  // deterministic stride subsample to bound the Hessian cost
  const cap = opts.maxRows ?? 60_000;
  let Xs = X;
  let ys = y;
  let m = n;
  if (n > cap) {
    const step = n / cap;
    m = cap;
    Xs = new Float64Array(m * P);
    ys = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const src = Math.floor(i * step);
      Xs.set(X.subarray(src * P, src * P + P), i * P);
      ys[i] = y[src]!;
    }
  }
  const scaler = fitScaler(Xs, m, P, opts.logCols);
  const proto: LogregModel = {
    P,
    ...scaler,
    coef: new Float64Array(P),
    intercept: 0,
    C: 1,
    iterations: 0,
    converged: false,
  };
  const Z = standardiseAll(proto, Xs, m);
  let pos = 0;
  for (let i = 0; i < m; i++) pos += ys[i]!;
  const neg = m - pos;
  const wPos = pos > 0 ? m / (2 * pos) : 1;
  const wNeg = neg > 0 ? m / (2 * neg) : 1;
  const w = new Float64Array(m);
  for (let i = 0; i < m; i++) w[i] = ys[i] === 1 ? wPos : wNeg;

  const D = P + 1; // coef + intercept
  const out: LogregModel[] = [];
  let theta = new Float64Array(D); // [beta..., intercept]
  for (const C of Cs) {
    const obj = (th: Float64Array): number => {
      let reg = 0;
      for (let j = 0; j < P; j++) reg += th[j]! * th[j]!;
      let loss = 0;
      for (let i = 0; i < m; i++) {
        let z = th[P]!;
        for (let j = 0; j < P; j++) z += Z[i * P + j]! * th[j]!;
        // log(1+e^z) - y z, stable
        const sp = z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
        loss += w[i]! * (sp - (ys[i] === 1 ? z : 0));
      }
      return 0.5 * reg + C * loss;
    };
    let cur = obj(theta);
    let iterations = 0;
    let converged = false;
    for (let it = 0; it < 60; it++) {
      iterations = it + 1;
      const g = new Float64Array(D);
      const H = new Float64Array(D * D);
      for (let j = 0; j < P; j++) {
        g[j] = theta[j]!;
        H[j * D + j] = 1;
      }
      for (let i = 0; i < m; i++) {
        let z = theta[P]!;
        const base = i * P;
        for (let j = 0; j < P; j++) z += Z[base + j]! * theta[j]!;
        const p = sigmoid(z);
        const r = C * w[i]! * (p - (ys[i] === 1 ? 1 : 0));
        const h = C * w[i]! * p * (1 - p);
        for (let a = 0; a < P; a++) {
          const za = Z[base + a]!;
          g[a]! += r * za;
          const hza = h * za;
          for (let b = 0; b <= a; b++) H[a * D + b]! += hza * Z[base + b]!;
          H[P * D + a]! += hza;
        }
        g[P]! += r;
        H[P * D + P]! += h;
      }
      let gmax = 0;
      for (let a = 0; a < D; a++) gmax = Math.max(gmax, Math.abs(g[a]!));
      for (let a = 0; a < D; a++) for (let b = 0; b < a; b++) H[b * D + a] = H[a * D + b]!;
      if (gmax < 1e-6 * Math.max(1, C * m * 0.01)) {
        converged = true;
        break;
      }
      let ridge = 1e-9;
      let step: Float64Array | null = null;
      for (let tries = 0; tries < 6 && step === null; tries++) {
        const Hr = H.slice();
        for (let a = 0; a < D; a++) Hr[a * D + a]! += ridge;
        step = cholSolve(Hr, g, D);
        ridge *= 100;
      }
      if (step === null) break;
      let t = 1;
      let improved = false;
      for (let ls = 0; ls < 20; ls++) {
        const cand = new Float64Array(D);
        for (let a = 0; a < D; a++) cand[a] = theta[a]! - t * step[a]!;
        const f = obj(cand);
        if (f <= cur + 1e-12) {
          const delta = cur - f;
          theta = cand;
          cur = f;
          improved = true;
          if (delta < 1e-10 * Math.max(1, Math.abs(f))) converged = true;
          break;
        }
        t /= 2;
      }
      if (!improved || converged) {
        converged = converged || !improved;
        break;
      }
    }
    out.push({
      P,
      logCols: scaler.logCols,
      mean: scaler.mean,
      sd: scaler.sd,
      coef: theta.slice(0, P),
      intercept: theta[P]!,
      C,
      iterations,
      converged,
    });
  }
  return out;
}

/** Decision function (log-odds under balanced weights) for n design rows. */
export function logregDecision(model: LogregModel, X: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const row = new Float64Array(model.P);
  for (let i = 0; i < n; i++) {
    standardiseRow(model, X, i, row);
    let z = model.intercept;
    for (let j = 0; j < model.P; j++) z += row[j]! * model.coef[j]!;
    out[i] = z;
  }
  return out;
}
