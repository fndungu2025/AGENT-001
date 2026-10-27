import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { cleanTable } from "./clean";
import { computeFeatures } from "./features";
import type { FeatureBlock } from "./features";
import { analyzeInWorker, DEFAULT_OPTIONS, generateSample, suggestMapping } from "./index";
import { evaluateModels } from "./models";
import { makeRng, shuffleInPlace } from "./rng";
import { SEGMENT_ORDER } from "./rfm";
import { MAPPING, table } from "./test-helpers";
import type { Tup } from "./test-helpers";
import type { AnalysisResult, ColumnMapping, Progress } from "./types";
import { addMonthsDay, dayToIso } from "./values";

function mappingFor(columns: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const s of suggestMapping(columns)) if (s.column !== null) m[s.field] = s.column;
  return m;
}

const sample = generateSample();
const progress: Progress[] = [];
const t0 = Date.now();
const result: AnalysisResult = analyze(sample, mappingFor(sample.columns), DEFAULT_OPTIONS, (p) =>
  progress.push(p),
);
const elapsed = Date.now() - t0;

describe("end to end on the synthetic sample", () => {
  it("is labelled synthetic and reports progress through every stage", () => {
    expect(result.dataset).toEqual({ name: "Synthetic sample (not real data)", synthetic: true });
    const stages = new Set(progress.map((p) => p.stage));
    for (const s of [
      "cleaning",
      "features",
      "segmentation",
      "training",
      "evaluation",
      "scoring",
      "done",
    ]) {
      expect(stages.has(s as Progress["stage"])).toBe(true);
    }
    expect(progress[progress.length - 1]!.pct).toBe(100);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]!.pct).toBeGreaterThanOrEqual(progress[i - 1]!.pct);
  });

  it("cleans with a balanced reconciliation and the expected data quirks", () => {
    const q = result.quality;
    expect(q.reconciliation.balances).toBe(true);
    expect(q.rowsRead).toBe(sample.rows.length);
    expect(q.rowsKept).toBeLessThan(q.rowsRead);
    expect(q.profile.missingCustomerPct).toBeGreaterThan(12);
    expect(q.profile.missingCustomerPct).toBeLessThan(25);
    expect(q.rules.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);
    for (const id of ["R2", "R3", "R4", "R5", "R6"])
      expect(q.rules.find((r) => r.id === id)!.rows).toBeGreaterThan(0);
    expect(q.profile.wholesaleCustomers).toBeGreaterThan(100);
    expect(q.profile.topCountries[0]!.country).toBe("United Kingdom");
  });

  it("assigns every eligible customer exactly one segment and one cluster", () => {
    const ids = new Set(result.customers.map((c) => c.id));
    expect(ids.size).toBe(result.customers.length);
    expect(result.customers.length).toBe(result.kpis.activeCustomers);
    expect(result.customers.length).toBeGreaterThan(500);
    expect(result.segments.map((s) => s.key)).toEqual(SEGMENT_ORDER);
    expect(result.segments.reduce((a, s) => a + s.customers, 0)).toBe(result.customers.length);
    expect(result.segments.reduce((a, s) => a + s.customersPct, 0)).toBeGreaterThan(99.9);
    expect(result.clusters.reduce((a, c) => a + c.size, 0)).toBe(result.customers.length);
    const k = result.kmeans!.k;
    expect(k).toBeGreaterThanOrEqual(3);
    for (const c of result.customers) {
      expect(c.cluster).toBeGreaterThanOrEqual(1);
      expect(c.cluster).toBeLessThanOrEqual(k);
      expect(c.rfm.score).toBe(`${c.rfm.r}${c.rfm.f}${c.rfm.m}`);
    }
    expect(Object.keys(result.kmeans!.crosstab)).toEqual(SEGMENT_ORDER);
  });

  it("follows the evaluation protocol dates (A.5)", () => {
    const p = result.protocol!;
    expect(p.horizonDays).toBe(60);
    const dmax = p.scoringDate;
    const back = (iso: string, days: number): string =>
      dayToIso(Date.parse(`${iso}T00:00:00Z`) / 86_400_000 - days);
    expect(p.testCutoff).toBe(back(dmax, 60));
    expect(p.validationCutoff).toBe(back(dmax, 120));
    expect(p.trainCutoffs.length).toBeGreaterThanOrEqual(10);
    expect(p.trainCutoffs[p.trainCutoffs.length - 1]! <= back(dmax, 180)).toBe(true);
    expect(p.trainCutoffs[0]).toBe(
      dayToIso(
        addMonthsDay(
          Date.parse(`${result.quality.profile.dateMin}T00:00:00Z`) / 86_400_000 + 180,
          0,
        ),
      ),
    );
    expect(result.predictionSkipped).toBeUndefined();
  });

  it("evaluates baseline, logistic regression and random forest on the held-out test period", () => {
    expect(result.models.map((m) => m.name)).toEqual([
      "baseline_recency",
      "logreg",
      "random_forest",
    ]);
    for (const m of result.models) {
      expect(m.test.rocAuc).toBeGreaterThan(0.5);
      expect(m.test.nRows).toBeGreaterThan(300);
      expect(m.curves.roc.length).toBeLessThanOrEqual(200);
      expect(m.curves.roc[0]).toEqual([0, 0]);
      expect(m.testScores.length).toBeLessThanOrEqual(20_000);
      expect(m.importance.length).toBeGreaterThan(0);
    }
    const sel = result.models.find((m) => m.name === result.selectedModel)!;
    expect(sel.test.rocAuc).toBeGreaterThan(0.55);
    // printed for the report; synthetic data, not a performance claim
    console.log(
      `sample: rows=${sample.rows.length} kept=${result.quality.rowsKept} eligible=${result.kpis.activeCustomers} selected=${result.selectedModel} ` +
        result.models
          .map(
            (m) => `${m.name} test ROC ${m.test.rocAuc.toFixed(3)} PR ${m.test.prAuc.toFixed(3)}`,
          )
          .join(" | ") +
        ` flags=[${result.flags.join(",")}] ms=${elapsed}`,
    );
  });

  it("scores customers with probabilities, bands, expected value and at most 3 plain-language drivers", () => {
    for (const c of result.customers) {
      expect(c.pRepeat).toBeGreaterThanOrEqual(0);
      expect(c.pRepeat).toBeLessThanOrEqual(1);
      expect(c.riskBand).toBe(
        c.pRepeat >= 0.6 ? "high_chance" : c.pRepeat >= 0.3 ? "medium" : "low_chance",
      );
      expect(c.expectedValue).toBeCloseTo(c.pRepeat * c.avgOrderValue, 1);
      expect(c.drivers.length).toBeGreaterThan(0);
      expect(c.drivers.length).toBeLessThanOrEqual(3);
      for (const dr of c.drivers) expect(dr.text.length).toBeGreaterThan(10);
    }
    expect(result.kpis.expectedRepeaters).toBeGreaterThan(0);
  });

  it("is deterministic: two runs give identical results", () => {
    const again = analyze(sample, mappingFor(sample.columns), DEFAULT_OPTIONS);
    const strip = (r: AnalysisResult): string => JSON.stringify({ ...r, computedInMs: 0 });
    expect(strip(again)).toBe(strip(result));
  }, 60_000);

  it("falls back to running inline when Web Workers are unavailable and supports cancel", async () => {
    const job = analyzeInWorker(sample, mappingFor(sample.columns), {
      ...DEFAULT_OPTIONS,
      horizonDays: 30,
    });
    const r = await job.promise;
    expect(r.protocol!.horizonDays).toBe(30);
    const job2 = analyzeInWorker(sample, mappingFor(sample.columns), DEFAULT_OPTIONS);
    job2.cancel();
    await expect(job2.promise).rejects.toThrow(/cancelled/);
  }, 60_000);
});

describe("sanity: shuffled labels carry no signal", () => {
  it("models are no better than chance on label-shuffled data", () => {
    const d = cleanTable(sample, MAPPING, { cancellationMode: "net", dateOrder: "auto" });
    const H = 60;
    const dmax = d.dMax;
    const tTest = dmax - H;
    const tVal = tTest - H;
    const rng = makeRng(123);
    const shuffled = (T: number): FeatureBlock => {
      const b = computeFeatures(d, T, { horizon: H, excludeWholesale: false });
      const perm = new Int32Array(b.n);
      for (let i = 0; i < b.n; i++) perm[i] = i;
      shuffleInPlace(perm, rng);
      const y = new Uint8Array(b.n);
      for (let i = 0; i < b.n; i++) y[i] = b.y![perm[i]!]!;
      return { ...b, y };
    };
    const train: FeatureBlock[] = [];
    for (let m = 0; ; m++) {
      const day = addMonthsDay(d.dMin + 180, m);
      if (day > tVal - H) break;
      train.push(shuffled(day));
    }
    const ev = evaluateModels({
      train,
      val: shuffled(tVal),
      test: shuffled(tTest),
      nCust: d.nCust,
      countryNames: d.countries,
    });
    for (const m of ev.models) {
      expect(Math.abs(m.test.rocAuc - 0.5)).toBeLessThan(0.06);
    }
    const base = ev.models[0]!;
    for (const m of ev.models.slice(1)) expect(m.test.prAuc - base.test.prAuc).toBeLessThan(0.05);
  }, 60_000);
});

describe("small or short datasets", () => {
  it("skips prediction but still returns cleaning, RFM and clusters", () => {
    const rows: Tup[] = [];
    const rng = makeRng(5);
    for (let c = 0; c < 80; c++) {
      for (let k = 0; k < 1 + rng.int(4); k++) {
        rows.push([
          `${c}-${k}`,
          "P1",
          1 + rng.int(3),
          `2024-0${1 + rng.int(6)}-${10 + rng.int(15)}`,
          5 + rng.int(20),
          `c${c}`,
        ]);
      }
    }
    const r = analyze(table(rows, "tiny"), MAPPING, DEFAULT_OPTIONS);
    expect(r.predictionSkipped?.code).toBe("INSUFFICIENT_DATA");
    expect(r.protocol).toBeNull();
    expect(r.models).toEqual([]);
    expect(r.selectedModel).toBeNull();
    expect(r.customers.length).toBeGreaterThan(0);
    expect(r.segments.reduce((a, s) => a + s.customers, 0)).toBe(r.customers.length);
    expect(r.quality.warnings.some((w) => w.code === "INSUFFICIENT_CUSTOMERS")).toBe(true);
    expect(r.kpis.expectedRepeaters).toBe(0);
  });

  it("flags short history", () => {
    const rows: Tup[] = [];
    for (let c = 0; c < 400; c++)
      rows.push([`${c}`, "P1", 1, `2024-03-${String(1 + (c % 28)).padStart(2, "0")}`, 5, `c${c}`]);
    const r = analyze(table(rows), MAPPING, DEFAULT_OPTIONS);
    expect(r.predictionSkipped?.code).toBe("INSUFFICIENT_HISTORY");
    expect(r.quality.warnings.some((w) => w.code === "INSUFFICIENT_HISTORY")).toBe(true);
    expect(r.customers.length).toBe(400);
  });

  it("returns a clean empty result when nothing survives cleaning", () => {
    const r = analyze(table([["1", "P1", 1, "garbage", 5, "c1"]]), MAPPING, DEFAULT_OPTIONS);
    expect(r.customers).toEqual([]);
    expect(r.predictionSkipped?.code).toBe("INSUFFICIENT_DATA");
    expect(r.quality.rules[0]!.rows).toBe(1);
  });
});
