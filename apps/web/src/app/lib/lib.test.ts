import { describe, expect, it } from "vitest";
import { FIXTURE_RESULT } from "../fixtures/analysisResult";
import { csvCell, targetListCsv, toCsv } from "./csv";
import { NO_FILTERS, filterCustomers, sortCustomers } from "./customers";
import { statsAtThreshold } from "./threshold";

describe("csv", () => {
  it("prefixes formula-like strings with an apostrophe", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("quotes commas, quotes and newlines but leaves real numbers alone", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    expect(csvCell(-5.5)).toBe("-5.5");
  });
  it("protects the hostile fixture id in the target list", () => {
    const text = targetListCsv(FIXTURE_RESULT.customers, FIXTURE_RESULT.segments);
    expect(text).toContain("\"'=HYPERLINK(");
    expect(text.split("\r\n")[0]).toContain("chance_to_buy_again");
  });
  it("toCsv joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});

describe("customer filters", () => {
  it("filters by segment, band and minimum chance", () => {
    const cs = FIXTURE_RESULT.customers;
    const seg = filterCustomers(cs, { ...NO_FILTERS, segment: "champions" });
    expect(seg.length).toBeGreaterThan(0);
    expect(seg.every((c) => c.segment === "champions")).toBe(true);
    const high = filterCustomers(cs, { ...NO_FILTERS, band: "high_chance", minP: 0.7 });
    expect(high.every((c) => c.riskBand === "high_chance" && c.pRepeat >= 0.7)).toBe(true);
  });
  it("sorts descending by chance", () => {
    const s = sortCustomers(FIXTURE_RESULT.customers, "pRepeat", "desc");
    expect(s[0]?.pRepeat ?? 0).toBeGreaterThanOrEqual(s[1]?.pRepeat ?? 1);
  });
});

describe("threshold maths", () => {
  const scores = [
    { p: 0.9, y: 1 as const },
    { p: 0.8, y: 1 as const },
    { p: 0.7, y: 0 as const },
    { p: 0.2, y: 1 as const },
    { p: 0.1, y: 0 as const },
  ];
  it("computes the confusion matrix", () => {
    const s = statsAtThreshold(scores, 0.5);
    expect([s.tp, s.fp, s.fn, s.tn]).toEqual([2, 1, 1, 1]);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.recall).toBeCloseTo(2 / 3);
  });
  it("a higher threshold trades recall for precision", () => {
    const lo = statsAtThreshold(scores, 0.15);
    const hi = statsAtThreshold(scores, 0.85);
    expect(hi.precision).toBeGreaterThan(lo.precision);
    expect(hi.recall).toBeLessThan(lo.recall);
  });
});
