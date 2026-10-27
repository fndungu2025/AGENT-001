// The analysis pipeline: clean -> features -> RFM -> clusters -> models -> scoring.
// Pure and synchronous (no DOM), so it runs in a Web Worker and in unit tests.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in hot loops */
import { cleanTable } from "./clean";
import type { CleanData } from "./clean";
import { computeFeatures, FEATURE_INDEX as F, NB, wholesaleAt } from "./features";
import type { FeatureBlock } from "./features";
import { renderDriver, topGroups, GROUP_NAMES } from "./explain";
import { adjustedRandIndex, chooseK } from "./kmeans";
import { evaluateModels, fitAndScore } from "./models";
import { computeRfm, SEGMENT_INFO, SEGMENT_ORDER, summariseSegments } from "./rfm";
import type {
  AnalysisOptions,
  AnalysisResult,
  ClusterSummary,
  ColumnMapping,
  CustomerRow,
  Driver,
  KmeansDiagnostics,
  MonthlyPoint,
  Progress,
  Protocol,
  QualityReport,
  RawTable,
  RiskBand,
  SegmentKey,
} from "./types";
import { addMonthsDay, dayToIso, dayToMonth } from "./values";

export type ProgressFn = (p: Progress) => void;

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export function riskBand(p: number): RiskBand {
  return p >= 0.6 ? "high_chance" : p >= 0.3 ? "medium" : "low_chance";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function analyze(
  table: RawTable,
  mapping: ColumnMapping,
  options: AnalysisOptions,
  onProgress?: ProgressFn,
): AnalysisResult {
  const t0 = Date.now();
  const report = (stage: Progress["stage"], pct: number, message: string): void => {
    onProgress?.({ stage, pct, message });
  };
  const H = options.horizonDays;

  // ---------- cleaning ----------
  report("cleaning", 3, "Cleaning rows and reconciling revenue");
  const d = cleanTable(table, mapping, {
    cancellationMode: options.cancellationMode,
    dateOrder: options.dateOrder,
    nonProductCodes: options.nonProductCodes,
  });
  const dataset = { name: table.name, synthetic: table.synthetic === true };
  const excludeWholesale = options.excludeWholesale === true;
  if (d.nRows === 0 || d.nOrders === 0) {
    return emptyResult(
      dataset,
      d,
      t0,
      "INSUFFICIENT_DATA",
      "No usable purchases were found after cleaning.",
    );
  }
  const quality = d.quality;
  const span = d.dMax - d.dMin;

  // wholesale profile (R8) as of the last data date
  const wFlags = wholesaleAt(d, d.dMax);
  let wholesaleCount = 0;
  let wRows = 0;
  let wRev = 0;
  for (let c = 0; c < d.nCust; c++) {
    if (wFlags[c] !== 1) continue;
    wholesaleCount++;
    wRows += d.rowStart[c + 1]! - d.rowStart[c]!;
    for (let r = d.rowStart[c]!; r < d.rowStart[c + 1]!; r++) wRev += d.rRev[r]!;
  }
  quality.profile.wholesaleCustomers = wholesaleCount;
  const r8 = quality.rules[7]!;
  r8.rows = wRows;
  r8.revenue = round2(wRev / 100);
  r8.description = excludeWholesale
    ? "Wholesale accounts (net spend in the top 1% or average quantity per line above 50) - excluded from the analysis"
    : "Wholesale accounts (net spend in the top 1% or average quantity per line above 50) - flagged only, not excluded";

  // ---------- features at the scoring date + RFM + clusters ----------
  report("features", 12, "Building customer features");
  const sc = computeFeatures(d, d.dMax, { horizon: null, excludeWholesale });
  const nSc = sc.n;
  if (nSc < 200) {
    quality.warnings.push({
      code: "INSUFFICIENT_CUSTOMERS",
      severity: "warning",
      message: `Only ${nSc} customers bought in the last 12 months. At least 200 are needed for a reliable prediction.`,
    });
  }
  if (span < 180) {
    quality.warnings.push({
      code: "INSUFFICIENT_HISTORY",
      severity: "warning",
      message: `The file covers ${span} days. At least 180 days of history are needed to predict repeat purchases.`,
    });
  }

  report("segmentation", 22, "Scoring recency, frequency and spend");
  const rec = new Float64Array(nSc);
  const freq = new Float64Array(nSc);
  const mon = new Float64Array(nSc);
  for (let i = 0; i < nSc; i++) {
    rec[i] = sc.X[i * NB + F.recency]!;
    freq[i] = sc.X[i * NB + F.frequency]!;
    mon[i] = sc.X[i * NB + F.monetary]!;
  }
  const rfm = computeRfm({ recency: rec, frequency: freq, monetary: mon });

  report("segmentation", 28, "Grouping customers with k-means");
  const flags: string[] = [];
  const dim = 3;
  const Z = new Float64Array(nSc * dim);
  for (let i = 0; i < nSc; i++) {
    Z[i * dim] = Math.log1p(rec[i]!);
    Z[i * dim + 1] = Math.log1p(freq[i]!);
    Z[i * dim + 2] = Math.log1p(Math.max(0, mon[i]!));
  }
  for (let j = 0; j < dim; j++) {
    let m = 0;
    for (let i = 0; i < nSc; i++) m += Z[i * dim + j]!;
    m /= Math.max(nSc, 1);
    let v = 0;
    for (let i = 0; i < nSc; i++) v += (Z[i * dim + j]! - m) ** 2;
    const sd = Math.sqrt(v / Math.max(nSc, 1)) || 1;
    for (let i = 0; i < nSc; i++) Z[i * dim + j] = (Z[i * dim + j]! - m) / sd;
  }
  const choice = chooseK(Z, nSc, dim);
  const cluster = new Int32Array(nSc).fill(1);
  let kmeansDiag: KmeansDiagnostics | null = null;
  let k = 0;
  if (choice !== null) {
    k = choice.fit.k;
    // renumber clusters 1..k by descending mean spend (standardised log-monetary centroid)
    const rank = Array.from({ length: k }, (_, c) => c).sort(
      (a, b) => choice.fit.centroids[b * dim + 2]! - choice.fit.centroids[a * dim + 2]! || a - b,
    );
    const newId = new Int32Array(k);
    rank.forEach((old, pos) => {
      newId[old] = pos + 1;
    });
    for (let i = 0; i < nSc; i++) cluster[i] = newId[choice.fit.labels[i]!]!;
    if (choice.smallClusterFallback) flags.push("kmeans_small_cluster");
    const segIdx = rfm.segment.map((s) => SEGMENT_ORDER.indexOf(s));
    const crosstab: Record<string, number[]> = {};
    for (const s of SEGMENT_ORDER) crosstab[s] = new Array<number>(k).fill(0);
    for (let i = 0; i < nSc; i++) crosstab[rfm.segment[i]!]![cluster[i]! - 1]!++;
    kmeansDiag = {
      k,
      silhouette: round4(choice.silhouette),
      tried: choice.tried.map((t) => ({
        k: t.k,
        inertia: round2(t.inertia),
        silhouette: round4(t.silhouette),
      })),
      adjustedRandIndexVsRfm: round4(adjustedRandIndex(segIdx, Array.from(cluster))),
      crosstab,
    };
  }

  // ---------- prediction ----------
  let protocol: Protocol | null = null;
  let predictionSkipped: AnalysisResult["predictionSkipped"];
  let models: AnalysisResult["models"] = [];
  let selectedModel: AnalysisResult["selectedModel"] = null;
  let p: Float64Array = new Float64Array(nSc);
  let contrib: Float64Array | null = null;
  let G = NB + 1;

  const tTest = d.dMax - H;
  const tVal = tTest - H;
  const tMin = d.dMin + 180;
  const lastTrain = tVal - H;
  const trainDays: number[] = [];
  for (let m = 0; ; m++) {
    const day = addMonthsDay(tMin, m);
    if (day > lastTrain) break;
    trainDays.push(day);
  }
  if (nSc < 200) {
    predictionSkipped = {
      code: "INSUFFICIENT_DATA",
      message: `Only ${nSc} customers bought in the last 12 months; at least 200 are needed to predict repeat purchases.`,
    };
  } else if (span < 180 || trainDays.length === 0) {
    predictionSkipped = {
      code: "INSUFFICIENT_HISTORY",
      message: `Predicting repeat purchases within ${H} days needs about ${180 + 3 * H} days of order history; this file covers ${span} days.`,
    };
  } else {
    report("training", 34, "Building training snapshots");
    const cache = new Map<number, FeatureBlock>();
    const block = (day: number): FeatureBlock => {
      let b = cache.get(day);
      if (b === undefined) {
        b = computeFeatures(d, day, { horizon: H, excludeWholesale });
        cache.set(day, b);
      }
      return b;
    };
    const train = trainDays.map(block);
    const val = block(tVal);
    const test = block(tTest);
    const pos = (bs: FeatureBlock[]): number =>
      bs.reduce((a, b) => a + b.y!.reduce((s, v) => s + v, 0), 0);
    const trainPos = pos(train);
    const valPos = pos([val]);
    const testPos = pos([test]);
    if (trainPos < 30 || valPos < 30 || testPos < 30) {
      predictionSkipped = {
        code: "INSUFFICIENT_DATA",
        message: `Not enough repeat purchases to evaluate a model (train ${trainPos}, validation ${valPos}, test ${testPos}; at least 30 are needed in each).`,
      };
    } else {
      report("training", 42, "Training and tuning models");
      const ev = evaluateModels({
        train,
        val,
        test,
        nCust: d.nCust,
        countryNames: d.countries,
        onStep: (msg) => {
          report("training", 55, msg);
        },
      });
      models = ev.models;
      selectedModel = ev.selected;
      flags.push(...ev.flags);
      report("evaluation", 78, "Evaluating on the held-out test period");
      const fitDays = new Set<number>(trainDays);
      for (let m = 0; ; m++) {
        const day = addMonthsDay(tMin, m);
        if (day > tTest) break;
        fitDays.add(day);
      }
      fitDays.add(tVal);
      fitDays.add(tTest);
      const fitBlocks = [...fitDays].sort((a, b) => a - b).map(block);
      report("scoring", 86, "Refitting on all labelled history and scoring customers");
      const out = fitAndScore(ev.selected, ev.choice, fitBlocks, test, sc, d.nCust, d.countries);
      p = out.p;
      contrib = out.contrib;
      G = out.G;
      protocol = {
        horizonDays: H,
        scoringDate: dayToIso(d.dMax),
        testCutoff: dayToIso(tTest),
        validationCutoff: dayToIso(tVal),
        trainCutoffs: trainDays.map(dayToIso),
        eligibleAtScoring: nSc,
        trainRows: ev.trainRows,
      };
    }
  }
  if (predictionSkipped !== undefined) {
    quality.warnings.push({
      code: predictionSkipped.code,
      severity: "warning",
      message: `Prediction skipped: ${predictionSkipped.message}`,
    });
  }

  // ---------- assemble customers ----------
  report("scoring", 94, "Preparing customer results");
  const hasPrediction = selectedModel !== null;
  const segMedianRec = new Map<SegmentKey, number>();
  for (const s of SEGMENT_ORDER) {
    const vals: number[] = [];
    for (let i = 0; i < nSc; i++) if (rfm.segment[i] === s) vals.push(rec[i]!);
    segMedianRec.set(s, median(vals));
  }
  const customers: CustomerRow[] = new Array<CustomerRow>(nSc);
  for (let i = 0; i < nSc; i++) {
    const recency = rec[i]!;
    const tenure = sc.X[i * NB + F.tenure]!;
    const aov = round2(sc.X[i * NB + F.aov]!);
    const seg = rfm.segment[i]!;
    const pr = hasPrediction ? round4(p[i]!) : 0;
    let drivers: Driver[] = [];
    if (hasPrediction) {
      const ctx = {
        row: sc.X,
        offset: i * NB,
        segmentMedianRecency: segMedianRec.get(seg) ?? 0,
        country: d.countries[sc.country[i]!] ?? "Unknown",
      };
      if (contrib === null) {
        drivers = [
          renderDriver("recency_days", recency > (segMedianRec.get(seg) ?? 0) ? "down" : "up", ctx),
        ];
      } else {
        drivers = topGroups(contrib, i, G, 3).map((g) =>
          renderDriver(GROUP_NAMES[g]!, contrib![i * G + g]! > 0 ? "up" : "down", ctx),
        );
      }
    }
    customers[i] = {
      id: d.custIds[sc.cust[i]!]!,
      country: d.countries[sc.country[i]!] ?? "Unknown",
      lastOrder: dayToIso(d.dMax - recency),
      firstOrder: dayToIso(d.dMax - tenure),
      recencyDays: recency,
      frequency: freq[i]!,
      monetary: round2(mon[i]!),
      avgOrderValue: aov,
      isWholesale: sc.X[i * NB + F.wholesale] === 1,
      rfm: {
        r: rfm.r[i]!,
        f: rfm.f[i]!,
        m: rfm.m[i]!,
        score: `${rfm.r[i]!}${rfm.f[i]!}${rfm.m[i]!}`,
      },
      segment: seg,
      cluster: cluster[i]!,
      pRepeat: pr,
      riskBand: riskBand(pr),
      expectedValue: round2(pr * aov),
      drivers,
    };
  }

  const pArr = customers.map((c) => c.pRepeat);
  const segments = summariseSegments({
    segment: rfm.segment,
    recency: rec,
    frequency: freq,
    monetary: mon,
    pRepeat: pArr,
  });

  // clusters
  const clusters: ClusterSummary[] = [];
  if (k > 0) {
    const overallMedianM = median(Array.from(mon));
    let totalRev = 0;
    for (let i = 0; i < nSc; i++) totalRev += mon[i]!;
    for (let c = 1; c <= k; c++) {
      const mem: number[] = [];
      for (let i = 0; i < nSc; i++) if (cluster[i] === c) mem.push(i);
      const segCount = new Map<SegmentKey, number>();
      let rev = 0;
      let ps = 0;
      for (const i of mem) {
        rev += mon[i]!;
        ps += pArr[i]!;
        segCount.set(rfm.segment[i]!, (segCount.get(rfm.segment[i]!) ?? 0) + 1);
      }
      let dominant: SegmentKey = "inactive";
      let best = -1;
      for (const s of SEGMENT_ORDER) {
        const cnt = segCount.get(s) ?? 0;
        if (cnt > best) {
          best = cnt;
          dominant = s;
        }
      }
      const medM = median(mem.map((i) => mon[i]!));
      const spend =
        medM >= overallMedianM * 1.5
          ? "high spend"
          : medM <= overallMedianM * 0.67
            ? "low spend"
            : "mid spend";
      clusters.push({
        cluster: c,
        name: `Cluster ${c} · mostly ${SEGMENT_INFO[dominant].name} · ${spend}`,
        size: mem.length,
        sizePct: round2((mem.length / nSc) * 100),
        revenue: round2(rev),
        revenuePct: totalRev > 0 ? round2((rev / totalRev) * 100) : 0,
        medianRecencyDays: median(mem.map((i) => rec[i]!)),
        medianFrequency: median(mem.map((i) => freq[i]!)),
        medianMonetary: round2(medM),
        avgPRepeat: mem.length > 0 ? round4(ps / mem.length) : 0,
        dominantSegment: dominant,
      });
    }
  }

  // ---------- monthly series + KPIs ----------
  const monthOfDay = new Int32Array(d.dMax - d.dMin + 1);
  const monthLabels: string[] = [];
  const monthIndex = new Map<string, number>();
  for (let day = d.dMin; day <= d.dMax; day++) {
    const label = dayToMonth(day);
    let mi = monthIndex.get(label);
    if (mi === undefined) {
      mi = monthLabels.length;
      monthIndex.set(label, mi);
      monthLabels.push(label);
    }
    monthOfDay[day - d.dMin] = mi;
  }
  const mRev = new Float64Array(monthLabels.length);
  const mOrders = new Float64Array(monthLabels.length);
  const mCust = new Float64Array(monthLabels.length);
  for (let r = 0; r < d.nRows; r++) mRev[monthOfDay[d.rDay[r]! - d.dMin]!]! += d.rRev[r]!;
  const seenMonth = new Int32Array(monthLabels.length).fill(-1);
  let ordersWin = 0;
  let grossWin = 0;
  for (let c = 0; c < d.nCust; c++) {
    for (let o = d.orderStart[c]!; o < d.orderStart[c + 1]!; o++) {
      const mi = monthOfDay[d.oDay[o]! - d.dMin]!;
      mOrders[mi]!++;
      if (seenMonth[mi] !== c) {
        seenMonth[mi] = c;
        mCust[mi]!++;
      }
      if (d.oDay[o]! >= d.dMax - 365) {
        ordersWin++;
        grossWin += d.oGross[o]!;
      }
    }
  }
  const monthly: MonthlyPoint[] = monthLabels.map((month, i) => ({
    month,
    revenue: round2(mRev[i]! / 100),
    orders: mOrders[i]!,
    customers: mCust[i]!,
  }));
  let rev12 = 0;
  for (let r = 0; r < d.nRows; r++) if (d.rDay[r]! >= d.dMax - 365) rev12 += d.rRev[r]!;
  let repeaters = 0;
  let expected = 0;
  let atRisk = 0;
  for (let i = 0; i < nSc; i++) {
    if (freq[i]! >= 2) repeaters++;
    if (hasPrediction) {
      expected += pArr[i]!;
      atRisk += (1 - pArr[i]!) * customers[i]!.avgOrderValue;
    }
  }

  report("done", 100, "Done");
  const result: AnalysisResult = {
    dataset,
    quality: finishQuality(quality),
    protocol,
    customers,
    segments,
    clusters,
    kmeans: kmeansDiag,
    models,
    selectedModel,
    flags,
    monthly,
    kpis: {
      activeCustomers: nSc,
      netRevenue12m: round2(rev12 / 100),
      repeatCustomerRate: nSc > 0 ? round4(repeaters / nSc) : 0,
      avgOrderValue: ordersWin > 0 ? round2(grossWin / 100 / ordersWin) : 0,
      expectedRepeaters: round2(expected),
      // revenue at risk = sum over customers of P(no repeat) x average order value (an estimate
      // of one order's worth of revenue per customer who does not buy again within the horizon)
      revenueAtRisk: round2(atRisk),
    },
    computedInMs: Date.now() - t0,
  };
  if (predictionSkipped !== undefined) result.predictionSkipped = predictionSkipped;
  return result;
}

function finishQuality(q: QualityReport): QualityReport {
  return q;
}

function emptyResult(
  dataset: AnalysisResult["dataset"],
  d: CleanData,
  t0: number,
  code: "INSUFFICIENT_DATA" | "INSUFFICIENT_HISTORY",
  message: string,
): AnalysisResult {
  const quality = d.quality;
  quality.warnings.push({ code, severity: "error", message });
  return {
    dataset,
    quality,
    protocol: null,
    predictionSkipped: { code, message },
    customers: [],
    segments: summariseSegments({
      segment: [],
      recency: [],
      frequency: [],
      monetary: [],
      pRepeat: [],
    }),
    clusters: [],
    kmeans: null,
    models: [],
    selectedModel: null,
    flags: [],
    monthly: [],
    kpis: {
      activeCustomers: 0,
      netRevenue12m: 0,
      repeatCustomerRate: 0,
      avgOrderValue: 0,
      expectedRepeaters: 0,
      revenueAtRisk: 0,
    },
    computedInMs: Date.now() - t0,
  };
}
