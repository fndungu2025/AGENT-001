// UI FIXTURE — hand-built, deterministic, SYNTHETIC. Used only for component tests and the
// dev-only `?fixture=1` flag. It is NOT output of the analytics engine and describes no real shop.
import type {
  AnalysisResult,
  ClusterSummary,
  CustomerRow,
  Driver,
  ModelMetrics,
  ModelName,
  ModelResult,
  RiskBand,
  SegmentKey,
  SegmentSummary,
} from "../../engine";
import { SEGMENTS } from "../meta";

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Profile {
  seg: SegmentKey;
  count: number;
  rec: [number, number];
  freq: [number, number];
  aov: [number, number];
  p: [number, number];
  rfm: [number, number, number];
  cluster: number;
}
const PROFILES: Profile[] = [
  { seg: "champions", count: 6, rec: [2, 25], freq: [12, 30], aov: [220, 520], p: [0.72, 0.93], rfm: [5, 5, 5], cluster: 0 },
  { seg: "loyal", count: 9, rec: [10, 60], freq: [6, 14], aov: [120, 300], p: [0.55, 0.82], rfm: [4, 4, 4], cluster: 0 },
  { seg: "new_promising", count: 8, rec: [3, 40], freq: [1, 3], aov: [60, 180], p: [0.3, 0.6], rfm: [5, 1, 2], cluster: 2 },
  { seg: "high_value_infrequent", count: 6, rec: [30, 120], freq: [2, 4], aov: [450, 900], p: [0.25, 0.55], rfm: [3, 2, 5], cluster: 1 },
  { seg: "needs_attention", count: 9, rec: [60, 140], freq: [3, 7], aov: [80, 200], p: [0.2, 0.45], rfm: [3, 3, 3], cluster: 2 },
  { seg: "at_risk", count: 9, rec: [120, 260], freq: [4, 12], aov: [100, 260], p: [0.08, 0.32], rfm: [2, 4, 4], cluster: 3 },
  { seg: "cant_lose", count: 5, rec: [150, 320], freq: [10, 25], aov: [250, 600], p: [0.06, 0.28], rfm: [1, 5, 5], cluster: 1 },
  { seg: "inactive", count: 10, rec: [250, 520], freq: [1, 3], aov: [30, 90], p: [0.01, 0.12], rfm: [1, 1, 1], cluster: 3 },
];
const COUNTRIES = ["United Kingdom", "United Kingdom", "United Kingdom", "United Kingdom", "Germany", "France", "EIRE", "Netherlands"];

function band(p: number): RiskBand {
  return p >= 0.6 ? "high_chance" : p >= 0.3 ? "medium" : "low_chance";
}

function makeCustomers(): CustomerRow[] {
  const rand = rng(42);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const out: CustomerRow[] = [];
  let n = 12000;
  const scoring = Date.UTC(2011, 11, 9);
  for (const pr of PROFILES) {
    for (let i = 0; i < pr.count; i++) {
      const recencyDays = Math.round(between(...pr.rec));
      const frequency = Math.round(between(...pr.freq));
      const avgOrderValue = r2(between(...pr.aov));
      const monetary = r2(avgOrderValue * frequency);
      const pRepeat = Math.round(between(...pr.p) * 1000) / 1000;
      const last = new Date(scoring - recencyDays * 86400000).toISOString().slice(0, 10);
      const first = new Date(scoring - (recencyDays + frequency * 30 + 20) * 86400000).toISOString().slice(0, 10);
      const drivers: Driver[] = [
        {
          feature: "recency_days",
          direction: pRepeat >= 0.4 ? "up" : "down",
          text:
            pRepeat >= 0.4
              ? `Ordered ${String(recencyDays)} days ago, which is recent for this shop.`
              : `Last order was ${String(recencyDays)} days ago, longer than usual.`,
        },
        {
          feature: "frequency",
          direction: frequency >= 5 ? "up" : "down",
          text: frequency >= 5 ? `Has placed ${String(frequency)} orders, so a regular buyer.` : `Only ${String(frequency)} orders so far.`,
        },
        { feature: "avg_order_value", direction: avgOrderValue > 200 ? "up" : "down", text: `Average order of about £${String(Math.round(avgOrderValue))}.` },
      ];
      out.push({
        id: String(n++),
        country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)] ?? "United Kingdom",
        lastOrder: last,
        firstOrder: first,
        recencyDays,
        frequency,
        monetary,
        avgOrderValue,
        isWholesale: avgOrderValue > 480 || (pr.seg === "champions" && i === 0),
        rfm: { r: pr.rfm[0], f: pr.rfm[1], m: pr.rfm[2], score: `${String(pr.rfm[0])}${String(pr.rfm[1])}${String(pr.rfm[2])}` },
        segment: pr.seg,
        cluster: pr.cluster,
        pRepeat,
        riskBand: band(pRepeat),
        expectedValue: r2(pRepeat * avgOrderValue),
        drivers,
      });
    }
  }
  // a hostile id to prove CSV-injection protection end to end
  const first = out[0];
  if (first) first.id = "=HYPERLINK(\"http://example.com\")";
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

function segmentSummaries(cs: CustomerRow[]): SegmentSummary[] {
  const total = cs.reduce((a, c) => a + c.monetary, 0);
  return SEGMENTS.map((m) => {
    const rows = cs.filter((c) => c.segment === m.key);
    const revenue = r2(rows.reduce((a, c) => a + c.monetary, 0));
    return {
      key: m.key,
      name: m.name,
      description: m.blurb,
      action: m.action,
      customers: rows.length,
      customersPct: rows.length / cs.length,
      revenue,
      revenuePct: total > 0 ? revenue / total : 0,
      avgRecencyDays: r2(avg(rows.map((c) => c.recencyDays))),
      avgFrequency: r2(avg(rows.map((c) => c.frequency))),
      avgMonetary: r2(avg(rows.map((c) => c.monetary))),
      avgPRepeat: avg(rows.map((c) => c.pRepeat)),
    };
  });
}

const CLUSTER_NAMES = ["Frequent high spenders", "Occasional big orders", "Mixed and recent", "Lapsed customers"];
function clusterSummaries(cs: CustomerRow[]): ClusterSummary[] {
  const total = cs.reduce((a, c) => a + c.monetary, 0);
  return CLUSTER_NAMES.map((name, cluster) => {
    const rows = cs.filter((c) => c.cluster === cluster);
    const counts = new Map<SegmentKey, number>();
    for (const c of rows) counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1);
    const dominantSegment = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "inactive";
    const revenue = r2(rows.reduce((a, c) => a + c.monetary, 0));
    return {
      cluster,
      name,
      size: rows.length,
      sizePct: rows.length / cs.length,
      revenue,
      revenuePct: total > 0 ? revenue / total : 0,
      medianRecencyDays: median(rows.map((c) => c.recencyDays)),
      medianFrequency: median(rows.map((c) => c.frequency)),
      medianMonetary: r2(median(rows.map((c) => c.monetary))),
      avgPRepeat: avg(rows.map((c) => c.pRepeat)),
      dominantSegment,
    };
  });
}

type Pair = { p: number; y: 0 | 1 };
function auc(pairs: Pair[]): number {
  const s = [...pairs].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  let pos = 0;
  s.forEach((x, i) => {
    if (x.y === 1) {
      rankSum += i + 1;
      pos++;
    }
  });
  const neg = s.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}
function curves(pairs: Pair[]): ModelResult["curves"] {
  const s = [...pairs].sort((a, b) => b.p - a.p);
  const P = s.filter((x) => x.y === 1).length;
  const N = s.length - P;
  const roc: [number, number][] = [[0, 0]];
  const pr: [number, number][] = [[0, 1]];
  const gain: [number, number][] = [[0, 0]];
  let tp = 0;
  let fp = 0;
  s.forEach((x, i) => {
    if (x.y === 1) tp++;
    else fp++;
    if ((i + 1) % 20 === 0 || i === s.length - 1) {
      roc.push([fp / N, tp / P]);
      pr.push([tp / P, tp / (tp + fp)]);
      gain.push([(i + 1) / s.length, tp / P]);
    }
  });
  const cal = Array.from({ length: 8 }, (_, b) => {
    const lo = b / 8;
    const hi = (b + 1) / 8;
    const rows = pairs.filter((x) => x.p >= lo && x.p < hi + (b === 7 ? 1 : 0));
    return { predicted: avg(rows.map((x) => x.p)), observed: avg(rows.map((x) => x.y)), n: rows.length };
  }).filter((c) => c.n > 0);
  return { roc, pr, calibration: cal, gain };
}
function metrics(pairs: Pair[], threshold: number, rocAuc: number, prAuc: number, capture20: number): ModelMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const x of pairs) {
    const pos = x.p >= threshold;
    if (pos && x.y) tp++;
    else if (pos) fp++;
    else if (x.y) fn++;
    else tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const positives = pairs.filter((x) => x.y === 1).length;
  return {
    nRows: pairs.length,
    nPositive: positives,
    baseRate: positives / pairs.length,
    rocAuc,
    prAuc,
    brier: 0.19,
    logLoss: 0.57,
    threshold,
    precision,
    recall,
    f1: (2 * precision * recall) / Math.max(1e-9, precision + recall),
    accuracy: (tp + tn) / pairs.length,
    liftTop10: 1.9,
    captureTop20: capture20,
  };
}

function makeModel(name: ModelName, label: string, signal: number, seed: number, prTest: number, capture: number): ModelResult {
  const rand = rng(seed);
  const gen = (n: number): Pair[] =>
    Array.from({ length: n }, () => {
      const y: 0 | 1 = rand() < 0.36 ? 1 : 0;
      const z = (y ? signal : -signal) * 0.5 + (rand() + rand() + rand() - 1.5) * 1.6;
      return { p: Math.round((1 / (1 + Math.exp(-z))) * 10000) / 10000, y };
    });
  const test = gen(900);
  const val = gen(700);
  const testAuc = auc(test);
  return {
    name,
    label,
    validation: metrics(val, 0.5, auc(val), prTest - 0.01, capture - 0.02),
    test: metrics(test, 0.5, testAuc, prTest, capture),
    curves: curves(test),
    importance: [
      { feature: "recency_days", importance: 0.34 },
      { feature: "frequency", importance: 0.26 },
      { feature: "monetary", importance: 0.16 },
      { feature: "avg_gap_days", importance: 0.14 },
      { feature: "tenure_days", importance: 0.1 },
    ],
    testScores: test,
    hyperparameters: name === "random_forest" ? { n_estimators: 300, max_depth: 8 } : name === "logreg" ? { C: 1, penalty: "l2" } : {},
  };
}

export function makeFixtureResult(opts: { synthetic?: boolean; gainLow?: boolean } = {}): AnalysisResult {
  const customers = makeCustomers();
  const segments = segmentSummaries(customers);
  const clusters = clusterSummaries(customers);
  const crosstab: Record<string, number[]> = {};
  for (const m of SEGMENTS) {
    crosstab[m.key] = [0, 1, 2, 3].map((k) => customers.filter((c) => c.segment === m.key && c.cluster === k).length);
  }
  const months: AnalysisResult["monthly"] = [];
  const mr = rng(7);
  for (let i = 0; i < 24; i++) {
    const y = 2010 + Math.floor((11 + i) / 12);
    const m = ((11 + i) % 12) + 1;
    const season = i % 12 >= 8 ? 1.5 : 1;
    const revenue = r2((52000 + mr() * 14000 + i * 900) * season);
    months.push({ month: `${String(y)}-${String(m).padStart(2, "0")}`, revenue, orders: Math.round(revenue / 410), customers: Math.round(revenue / 640) });
  }
  const models: ModelResult[] = [
    makeModel("baseline_recency", "Simple recency rule", 0.55, 11, 0.5, 0.41),
    makeModel("logreg", "Logistic regression", 0.95, 12, 0.6, 0.55),
    makeModel("random_forest", "Random forest", 1.15, 13, opts.gainLow ? 0.505 : 0.64, opts.gainLow ? 0.42 : 0.6),
  ];
  const net = r2(months.slice(-12).reduce((a, m) => a + m.revenue, 0));
  const atRisk = customers
    .filter((c) => (c.segment === "at_risk" || c.segment === "cant_lose") && c.pRepeat < 0.3)
    .reduce((a, c) => a + c.monetary, 0);
  return {
    dataset: { name: opts.synthetic === false ? "orders-2011.csv" : "Synthetic sample shop", synthetic: opts.synthetic ?? true },
    quality: {
      rowsRead: 52340,
      rowsKept: 47912,
      rules: [
        { id: "R1", description: "Unparseable date, quantity or price", rows: 12, revenue: 0 },
        { id: "R2", description: "Missing customer reference", rows: 3920, revenue: 118400.5 },
        { id: "R3", description: "Exact duplicate rows", rows: 221, revenue: 4310.2 },
        { id: "R4", description: "Cancellations and returns", rows: 1190, revenue: -52300.75 },
        { id: "R5", description: "Zero or negative price", rows: 41, revenue: 0 },
        { id: "R6", description: "Non-product stock codes", rows: 244, revenue: 6120.4 },
        { id: "R7", description: "Impossible dates", rows: 0, revenue: 0 },
        { id: "R8", description: "Wholesale customers flagged", rows: 1480, revenue: 231000 },
      ],
      reconciliation: { gross: 1204500.4, cancellations: -52300.75, excluded: 128831.1, net: 1023368.55, balances: true },
      profile: {
        customers: customers.length,
        invoices: 2210,
        products: 3180,
        dateMin: "2010-12-01",
        dateMax: "2011-12-09",
        topCountries: [
          { country: "United Kingdom", rowsPct: 0.86 },
          { country: "Germany", rowsPct: 0.04 },
          { country: "France", rowsPct: 0.03 },
        ],
        revenueShareTop1pct: 0.19,
        revenueShareTop10pct: 0.52,
        wholesaleCustomers: customers.filter((c) => c.isWholesale).length,
        missingCustomerPct: 0.075,
      },
      warnings: [
        { code: "missing_customer", severity: "warning", message: "7.5% of rows have no customer ID and were left out of customer analysis." },
        { code: "wholesale_share", severity: "warning", message: "Wholesale customers make up a large share of revenue (about 23%)." },
        { code: "single_country", severity: "info", message: "86% of rows come from one country (United Kingdom)." },
      ],
    },
    protocol: {
      horizonDays: 60,
      scoringDate: "2011-12-09",
      testCutoff: "2011-09-30",
      validationCutoff: "2011-07-31",
      trainCutoffs: ["2011-03-31", "2011-04-30", "2011-05-31", "2011-06-30"],
      eligibleAtScoring: customers.length,
      trainRows: 5400,
    },
    customers,
    segments,
    clusters,
    kmeans: {
      k: 4,
      silhouette: 0.41,
      tried: [2, 3, 4, 5, 6].map((k) => ({ k, inertia: Math.round(900 / k ** 0.8), silhouette: [0.38, 0.4, 0.41, 0.36, 0.33][k - 2] ?? 0.3 })),
      adjustedRandIndexVsRfm: 0.46,
      crosstab,
    },
    models,
    selectedModel: opts.gainLow ? "baseline_recency" : "random_forest",
    flags: opts.gainLow ? ["model_gain_low"] : [],
    monthly: months,
    kpis: {
      activeCustomers: customers.filter((c) => c.recencyDays <= 90).length,
      netRevenue12m: net,
      repeatCustomerRate: 0.64,
      avgOrderValue: 412.3,
      expectedRepeaters: r2(customers.reduce((a, c) => a + c.pRepeat, 0)),
      revenueAtRisk: r2(atRisk),
    },
    computedInMs: 4200,
  };
}

export const FIXTURE_RESULT: AnalysisResult = makeFixtureResult();
