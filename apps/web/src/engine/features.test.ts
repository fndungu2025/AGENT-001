/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
import { describe, expect, it } from "vitest";
import { cleanTable } from "./clean";
import type { CleanData } from "./clean";
import { computeFeatures, FEATURE_INDEX as F, NB } from "./features";
import { generateSample } from "./sample";
import { MAPPING, table } from "./test-helpers";
import type { Tup } from "./test-helpers";
import { isoToDay } from "./values";
import type { RawTable } from "./types";

const clean = (rows: Tup[]): CleanData =>
  cleanTable(table(rows), MAPPING, {
    cancellationMode: "net",
    dateOrder: "auto",
    nowMs: Date.UTC(2026, 0, 1),
  });

const FIXTURE: Tup[] = [
  // customer A
  ["I1", "P1", 2, "2024-01-10 10:00", 5, "A"],
  ["I2", "P2", 1, "2024-03-01 10:00", 20, "A"],
  ["I3", "P1", 3, "2024-05-01 10:00", 10, "A"],
  ["I4", "P3", 1, "2024-06-20 10:00", 40, "A"],
  ["C5", "P3", -1, "2024-06-25 10:00", 10, "A"],
  ["I6", "P1", 1, "2024-07-15 10:00", 10, "A"], // after T: label = 1
  // customer B: single order
  ["I7", "P1", 1, "2024-06-01 10:00", 5, "B", "France"],
  // customer C: last order outside the 365-day window
  ["I8", "P1", 1, "2023-05-01 10:00", 5, "C"],
  // customer E: first order after T
  ["I9", "P1", 1, "2024-08-01 10:00", 5, "E"],
];
const T = isoToDay("2024-06-30");

function byId(d: CleanData, b: ReturnType<typeof computeFeatures>): Map<string, Float64Array> {
  const m = new Map<string, Float64Array>();
  for (let i = 0; i < b.n; i++) m.set(d.custIds[b.cust[i]!]!, b.X.slice(i * NB, i * NB + NB));
  return m;
}

describe("features at a cutoff (A.3)", () => {
  const d = clean(FIXTURE);
  const b = computeFeatures(d, T, { horizon: 60, excludeWholesale: false });
  const rows = byId(d, b);

  it("keeps only customers with a purchase in the trailing 365 days", () => {
    expect([...rows.keys()].sort()).toEqual(["A", "B"]);
  });

  it("matches the hand-computed feature values for customer A", () => {
    const a = rows.get("A")!;
    expect(a[F.recency]).toBe(10);
    expect(a[F.frequency]).toBe(4);
    expect(a[F.monetary]).toBeCloseTo(90, 9);
    expect(a[F.tenure]).toBe(172);
    expect(a[F.aov]).toBeCloseTo(25, 9);
    expect(a[F.avgIp]).toBeCloseTo(54, 9);
    expect(a[F.stdIp]).toBeCloseTo(Math.sqrt(37), 9);
    expect(a[F.ratio]).toBeCloseTo(10 / 54, 9);
    expect(a[F.o30]).toBe(1);
    expect(a[F.o90]).toBe(2);
    expect(a[F.o180]).toBe(4);
    expect(a[F.rev90]).toBeCloseTo(60, 9);
    expect(a[F.trend]).toBe(0);
    expect(a[F.products]).toBe(3);
    expect(a[F.returnRate]).toBeCloseTo(0.1, 9);
    expect(a[F.single]).toBe(0);
  });

  it("handles single-purchase customers (tenure fill and indicator)", () => {
    const bb = rows.get("B")!;
    expect(bb[F.recency]).toBe(29);
    expect(bb[F.single]).toBe(1);
    expect(bb[F.avgIp]).toBe(29);
    expect(bb[F.stdIp]).toBe(0);
  });

  it("labels purchases in (T, T+H] only", () => {
    const idA = d.custIds.indexOf("A");
    const idx = Array.from(b.cust).indexOf(idA);
    expect(b.y![idx]).toBe(1);
    const idxB = Array.from(b.cust).indexOf(d.custIds.indexOf("B"));
    expect(b.y![idxB]).toBe(0);
    // horizon 10 days: A's order on 07-15 is outside (06-30, 07-10]
    const short = computeFeatures(d, T, { horizon: 10, excludeWholesale: false });
    expect(short.y![Array.from(short.cust).indexOf(idA)]).toBe(0);
  });

  it("unlabelled blocks have y = null", () => {
    expect(computeFeatures(d, T, { horizon: null, excludeWholesale: false }).y).toBeNull();
  });
});

describe("leakage: rows after the cutoff cannot change features at the cutoff", () => {
  function perturb(t: RawTable, cutoffIso: string): RawTable {
    const cut = `${cutoffIso} 23:59`;
    const after = t.rows.filter((r) => r[4]! > cut);
    const before = t.rows.filter((r) => r[4]! <= cut);
    // shuffle prices and quantities among post-cutoff rows, drop a third, add new rows/customers
    const prices = after.map((r) => r[5]!).reverse();
    const qtys = after.map((r) => r[3]!).reverse();
    const mutated = after
      .map((r, i) => [r[0]!, r[1]!, r[2]!, qtys[i]!, r[4]!, prices[i]!, r[6]!, r[7]!])
      .filter((_, i) => i % 3 !== 0);
    mutated.push(["999990", "P1", "7", "2024-12-20 10:00", "9.99", "NEWCUST", "Germany"]);
    mutated.push(["999991", "POST", "1", "2024-12-21 10:00", "18.00", "12347", "United Kingdom"]);
    return { ...t, rows: [...before, ...mutated] };
  }

  it("feature blocks at T are identical (per customer) when the future is perturbed", () => {
    const base = generateSample();
    const alt = perturb(base, "2024-03-01");
    const o = { cancellationMode: "net", dateOrder: "auto", nowMs: Date.UTC(2026, 0, 1) } as const;
    const d1 = cleanTable(base, MAPPING, o);
    const d2 = cleanTable(alt, MAPPING, o);
    const Tcut = isoToDay("2024-03-01");
    const b1 = byId(d1, computeFeatures(d1, Tcut, { horizon: null, excludeWholesale: false }));
    const b2 = byId(d2, computeFeatures(d2, Tcut, { horizon: null, excludeWholesale: false }));
    expect(b1.size).toBeGreaterThan(300);
    expect([...b2.keys()].sort()).toEqual([...b1.keys()].sort());
    for (const [id, row] of b1) {
      expect(JSON.stringify(Array.from(b2.get(id)!))).toBe(JSON.stringify(Array.from(row)));
    }
  });
});
