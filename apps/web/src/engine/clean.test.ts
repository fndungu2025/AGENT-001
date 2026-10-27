import { describe, expect, it } from "vitest";
import { cleanTable } from "./clean";
import type { CleanOptions } from "./clean";
import { wholesaleAt } from "./features";
import { COLUMNS, MAPPING, table } from "./test-helpers";
import type { Tup } from "./test-helpers";
import { parseDateMs, parseNumber, normalizeCustomerRef, isoToDay } from "./values";
import { analyze } from "./analyze";
import { DEFAULT_OPTIONS } from "./index";

const NOW = Date.UTC(2025, 0, 1);
const opts = (o: Partial<CleanOptions> = {}): CleanOptions => ({
  cancellationMode: "net",
  dateOrder: "auto",
  nowMs: NOW,
  ...o,
});
const rule = (d: ReturnType<typeof cleanTable>, id: string) =>
  d.quality.rules.find((r) => r.id === id)!;

const good: Tup = ["1001", "P1", 2, "2024-03-01 10:00", 5, "100"];

describe("cleaning rules R1-R8", () => {
  it("R1 excludes unparseable date, quantity, price or blank invoice", () => {
    const d = cleanTable(
      table([
        good,
        ["1002", "P1", "x", "2024-03-01", 5, "100"],
        ["1003", "P1", 2, "not a date", 5, "100"],
        ["1004", "P1", 2, "2024-03-01", "abc", "100"],
        ["", "P1", 2, "2024-03-01", 5, "100"],
      ]),
      MAPPING,
      opts(),
    );
    expect(rule(d, "R1").rows).toBe(4);
    expect(d.quality.rowsKept).toBe(1);
    expect(d.quality.reconciliation.balances).toBe(true);
  });

  it("R2 excludes missing customer refs and counts their revenue as excluded", () => {
    const d = cleanTable(
      table([
        good,
        ["1002", "P1", 3, "2024-03-02", 2, ""],
        ["1003", "P1", 1, "2024-03-02", 2, "  "],
      ]),
      MAPPING,
      opts(),
    );
    expect(rule(d, "R2").rows).toBe(2);
    expect(rule(d, "R2").revenue).toBe(8);
    expect(d.quality.reconciliation.excluded).toBe(8);
    expect(d.quality.profile.missingCustomerPct).toBeCloseTo(66.67, 1);
  });

  it("R3 keeps the first of exact duplicates", () => {
    const d = cleanTable(
      table([good, good, ["1001", "P1", 2, "2024-03-01 10:00", 5, "100"]]),
      MAPPING,
      opts(),
    );
    expect(rule(d, "R3").rows).toBe(2);
    expect(d.nRows).toBe(1);
  });

  it("R4 keeps cancellations as negative revenue in net mode and never as a purchase", () => {
    const rows: Tup[] = [
      good,
      ["C1002", "P1", -1, "2024-03-05", 5, "100"],
      ["1003", "P1", -1, "2024-03-06", 5, "100"],
    ];
    const net = cleanTable(table(rows), MAPPING, opts());
    expect(net.nRows).toBe(3);
    expect(net.quality.reconciliation.cancellations).toBe(-10);
    expect(net.quality.reconciliation.net).toBe(0);
    expect(net.nOrders).toBe(1); // only invoice 1001 is a purchase
    const ex = cleanTable(table(rows), MAPPING, opts({ cancellationMode: "exclude" }));
    expect(ex.nRows).toBe(1);
    expect(rule(ex, "R4").rows).toBe(2);
    expect(ex.quality.reconciliation.net).toBe(10);
    expect(ex.quality.reconciliation.balances).toBe(true);
  });

  it("treats a C-prefixed invoice with a positive quantity as a negative amount", () => {
    const d = cleanTable(table([good, ["C9", "P1", 1, "2024-03-05", 5, "100"]]), MAPPING, opts());
    expect(d.quality.reconciliation.cancellations).toBe(-5);
  });

  it("R5 excludes zero and negative prices on sale lines but not the cancellation itself", () => {
    const d = cleanTable(
      table([
        good,
        ["1002", "P1", 1, "2024-03-02", 0, "100"],
        ["1003", "P1", 1, "2024-03-02", -4, "100"],
      ]),
      MAPPING,
      opts(),
    );
    expect(rule(d, "R5").rows).toBe(2);
    expect(d.quality.reconciliation.excluded).toBe(-4);
    expect(d.quality.reconciliation.balances).toBe(true);
  });

  it("R6 excludes non-product codes (case-insensitive) and honours a custom list", () => {
    const rows: Tup[] = [
      good,
      ["1002", "post", 1, "2024-03-02", 18, "100"],
      ["1003", "Bank Charges", 1, "2024-03-02", 15, "100"],
      ["1004", "ZZ9", 1, "2024-03-02", 1, "100"],
    ];
    const d = cleanTable(table(rows), MAPPING, opts());
    expect(rule(d, "R6").rows).toBe(2);
    expect(d.nRows).toBe(2);
    const custom = cleanTable(table(rows), MAPPING, opts({ nonProductCodes: ["ZZ9"] }));
    expect(rule(custom, "R6").rows).toBe(1);
  });

  it("R7 excludes future dates and dates before 1990", () => {
    const d = cleanTable(
      table([
        good,
        ["1002", "P1", 1, "2031-01-01", 5, "100"],
        ["1003", "P1", 1, "1985-05-05", 5, "100"],
      ]),
      MAPPING,
      opts(),
    );
    expect(rule(d, "R7").rows).toBe(2);
    expect(d.nRows).toBe(1);
  });

  it("applies rules in order: a row is logged under the first rule it fails", () => {
    const d = cleanTable(table([["1002", "POST", 1, "2031-01-01", 0, ""]]), MAPPING, opts());
    expect(rule(d, "R2").rows).toBe(1);
    expect(rule(d, "R5").rows + rule(d, "R6").rows + rule(d, "R7").rows).toBe(0);
  });

  it("R8 flags wholesale by average quantity per line > 50 and by the p99 of net spend", () => {
    const rows: Tup[] = [];
    for (let c = 0; c < 200; c++) rows.push([`I${c}`, "P1", 1, "2024-03-01", 5 + (c % 7), `c${c}`]);
    rows.push(["IW", "P1", 100, "2024-03-01", 1, "bulk"]); // avg qty 100 > 50
    rows.push(["IB", "P1", 1, "2024-03-01", 5000, "big"]); // top spender
    const d = cleanTable(table(rows), MAPPING, opts());
    const flags = wholesaleAt(d, isoToDay("2024-03-31"));
    expect(flags[d.custIds.indexOf("bulk")]).toBe(1);
    expect(flags[d.custIds.indexOf("big")]).toBe(1);
    expect(flags[d.custIds.indexOf("c1")]).toBe(0);
  });
});

describe("reconciliation", () => {
  it("balances to the penny with awkward decimals and mixed exclusions", () => {
    const rows: Tup[] = [];
    for (let i = 0; i < 300; i++) {
      rows.push([
        `${2000 + i}`,
        "P1",
        1 + (i % 5),
        "2024-03-01",
        (0.07 * (i % 13) + 0.1).toFixed(2),
        `c${i % 40}`,
      ]);
      if (i % 11 === 0) rows.push([`C${3000 + i}`, "P1", -1, "2024-03-09", 0.33, `c${i % 40}`]);
      if (i % 17 === 0) rows.push([`${4000 + i}`, "POST", 1, "2024-03-09", 18.1, `c${i % 40}`]);
      if (i % 19 === 0) rows.push([`${5000 + i}`, "P2", 1, "2024-03-09", 3.3, ""]);
    }
    for (const mode of ["net", "exclude"] as const) {
      const d = cleanTable(table(rows), MAPPING, opts({ cancellationMode: mode }));
      const r = d.quality.reconciliation;
      expect(r.balances).toBe(true);
      expect(Math.round((r.gross + r.cancellations - r.excluded) * 100)).toBe(
        Math.round(r.net * 100),
      );
    }
  });
});

describe("customer refs and privacy", () => {
  it("normalises numeric refs", () => {
    expect(normalizeCustomerRef("12345.0")).toBe("12345");
    expect(normalizeCustomerRef(" 12345.00 ")).toBe("12345");
    expect(normalizeCustomerRef("nan")).toBe("");
    expect(normalizeCustomerRef("AB-12")).toBe("AB-12");
  });

  it("hashes email-like refs so raw emails never appear in the result", () => {
    const rows: Tup[] = [];
    for (let i = 0; i < 260; i++) {
      rows.push([
        `${i}`,
        "P1",
        1,
        `2023-0${1 + (i % 9)}-15`,
        5,
        i % 2 === 0 ? "Alice@Example.com " : `user${i}@shop.co.uk`,
      ]);
    }
    const t = table(rows, "emails");
    const result = analyze(t, MAPPING, DEFAULT_OPTIONS);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/@/);
    expect(json.toLowerCase()).not.toContain("alice");
    expect(result.quality.warnings.some((w) => w.code === "EMAIL_REFS_HASHED")).toBe(true);
    // same address in different case maps to one customer
    const d = cleanTable(
      table([
        ["1", "P1", 1, "2024-01-01", 5, "A@b.co"],
        ["2", "P1", 1, "2024-01-02", 5, "a@B.CO"],
      ]),
      MAPPING,
      opts(),
    );
    expect(d.nCust).toBe(1);
    expect(d.emailsHashed).toBe(2);
  });
});

describe("dates and numbers", () => {
  it("parses ISO, DMY, MDY, 2-digit years, AM/PM and Excel serials", () => {
    const day = (ms: number): string => new Date(ms).toISOString().slice(0, 16);
    expect(day(parseDateMs("2024-03-01 14:30", "DMY"))).toBe("2024-03-01T14:30");
    expect(day(parseDateMs("2024-03-01T14:30:00Z", "DMY"))).toBe("2024-03-01T14:30");
    expect(day(parseDateMs("25/12/2024 09:05", "DMY"))).toBe("2024-12-25T09:05");
    expect(day(parseDateMs("12/25/2024 09:05", "MDY"))).toBe("2024-12-25T09:05");
    expect(day(parseDateMs("1/2/24", "DMY"))).toBe("2024-02-01T00:00");
    expect(day(parseDateMs("03/04/2024 2:15 PM", "MDY"))).toBe("2024-03-04T14:15");
    expect(day(parseDateMs("45292", "DMY"))).toBe("2024-01-01T00:00");
    expect(day(parseDateMs("45292.5", "DMY"))).toBe("2024-01-01T12:00");
    expect(parseDateMs("31/02/2024", "DMY")).toBeNaN();
    expect(parseDateMs("garbage", "DMY")).toBeNaN();
  });

  it("parses numbers with currency symbols and separators", () => {
    expect(parseNumber("£1,234.50")).toBe(1234.5);
    expect(parseNumber("1.234,50")).toBe(1234.5);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("(3.20)")).toBe(-3.2);
    expect(parseNumber("-7")).toBe(-7);
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("")).toBeNaN();
  });

  it("detects day-first when a day exceeds 12, month-first otherwise, and warns when ambiguous", () => {
    const mk = (dates: string[]) =>
      cleanTable(table(dates.map((x, i) => [`${i}`, "P1", 1, x, 5, "c1"] as Tup)), MAPPING, opts());
    const dmy = mk(["25/03/2024", "01/04/2024"]);
    expect(dmy.dateOrderUsed).toBe("DMY");
    expect(dmy.quality.warnings.some((w) => w.code === "DMY_MDY_AMBIGUOUS")).toBe(false);
    const mdy = mk(["03/25/2024", "04/01/2024"]);
    expect(mdy.dateOrderUsed).toBe("MDY");
    expect(mdy.dMin).toBe(isoToDay("2024-03-25"));
    const amb = mk(["03/04/2024", "05/06/2024"]);
    expect(amb.dateOrderUsed).toBe("DMY");
    expect(amb.quality.warnings.some((w) => w.code === "DMY_MDY_AMBIGUOUS")).toBe(true);
    const forced = cleanTable(
      table([["1", "P1", 1, "03/04/2024", 5, "c1"]]),
      MAPPING,
      opts({ dateOrder: "MDY" }),
    );
    expect(forced.dMin).toBe(isoToDay("2024-03-04"));
    const iso = mk(["2024-03-04", "2024-05-06"]);
    expect(iso.quality.warnings.some((w) => w.code === "DMY_MDY_AMBIGUOUS")).toBe(false);
  });

  it("requires the mandatory fields", () => {
    expect(() =>
      cleanTable({ columns: COLUMNS, rows: [], name: "x" }, { quantity: "Quantity" }, opts()),
    ).toThrow(/map/);
  });
});
