/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
import { describe, expect, it } from "vitest";
import { generateSample, suggestMapping } from "./index";
import { parseCsvText, ParseError } from "./parse";
import { parseUpload } from "./parse";

const field = (cols: string[], f: string): string | null =>
  suggestMapping(cols).find((s) => s.field === f)!.column;

describe("parseCsvText", () => {
  it("auto-detects comma, semicolon and tab delimiters", () => {
    for (const sep of [",", ";", "\t"]) {
      const t = parseCsvText(`a${sep}b${sep}c\n1${sep}2${sep}3\n4${sep}5${sep}6\n`, "x.csv");
      expect(t.columns).toEqual(["a", "b", "c"]);
      expect(t.rows).toEqual([
        ["1", "2", "3"],
        ["4", "5", "6"],
      ]);
    }
  });

  it("handles quotes, BOM, blank lines, ragged rows and duplicate headers", () => {
    const t = parseCsvText('﻿Name,Name,Note\n"Smith, J",x,"say ""hi"""\n\nshort\n', "x.csv");
    expect(t.columns).toEqual(["Name", "Name (2)", "Note"]);
    expect(t.rows[0]).toEqual(["Smith, J", "x", 'say "hi"']);
    expect(t.rows[1]).toEqual(["short", "", ""]);
    expect(t.rows).toHaveLength(2);
  });

  it("gives friendly errors for empty files, missing headers and header-only files", () => {
    expect(() => parseCsvText("", "x.csv")).toThrow(ParseError);
    expect(() => parseCsvText("  \n ", "x.csv")).toThrow(/empty/);
    expect(() => parseCsvText("a,b,c\n", "x.csv")).toThrow(/no data rows/);
  });
});

describe("parseUpload", () => {
  it("rejects empty files and legacy .xls", async () => {
    await expect(parseUpload(new File([], "a.csv"))).rejects.toThrow(/empty/);
    await expect(parseUpload(new File(["x"], "a.xls"))).rejects.toThrow(/xlsx/);
  });

  it("decodes UTF-8 and falls back to windows-1252", async () => {
    const utf8 = await parseUpload(new File(["a,b\ncafé,1\n"], "u.csv"));
    expect(utf8.rows[0]![0]).toBe("café");
    const bytes = new Uint8Array([
      0x61, 0x2c, 0x62, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x0a,
    ]); // "caf\xe9" in cp1252
    const win = await parseUpload(new File([bytes], "w.csv"));
    expect(win.rows[0]![0]).toBe("café");
  });
});

describe("suggestMapping", () => {
  it("maps the UCI Online Retail II headers with high confidence", () => {
    const cols = [
      "Invoice",
      "StockCode",
      "Description",
      "Quantity",
      "InvoiceDate",
      "Price",
      "Customer ID",
      "Country",
    ];
    const s = suggestMapping(cols);
    expect(s).toHaveLength(8);
    expect(field(cols, "invoice_id")).toBe("Invoice");
    expect(field(cols, "stock_code")).toBe("StockCode");
    expect(field(cols, "invoice_ts")).toBe("InvoiceDate");
    expect(field(cols, "customer_ref")).toBe("Customer ID");
    expect(field(cols, "unit_price")).toBe("Price");
    for (const x of s) expect(x.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("maps Shopify/WooCommerce/Excel style headers and never reuses a column", () => {
    const cols = [
      "Order ID",
      "Order Date",
      "Customer Email",
      "Qty",
      "Unit Price",
      "SKU",
      "Product",
      "Billing Country",
    ];
    expect(field(cols, "invoice_id")).toBe("Order ID");
    expect(field(cols, "invoice_ts")).toBe("Order Date");
    expect(field(cols, "customer_ref")).toBe("Customer Email");
    expect(field(cols, "quantity")).toBe("Qty");
    expect(field(cols, "unit_price")).toBe("Unit Price");
    expect(field(cols, "stock_code")).toBe("SKU");
    expect(field(cols, "description")).toBe("Product");
    expect(field(cols, "country")).toBe("Billing Country");
    const used = suggestMapping(cols)
      .map((s) => s.column)
      .filter((c) => c !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it("returns null columns with confidence 0 when nothing matches", () => {
    const s = suggestMapping(["foo", "bar"]);
    expect(s.every((x) => x.column === null && x.confidence === 0)).toBe(true);
  });
});

describe("generateSample", () => {
  const a = generateSample();
  it("is deterministic and shaped like the UCI export", () => {
    expect(generateSample().rows).toEqual(a.rows);
    expect(a.synthetic).toBe(true);
    expect(a.name).toBe("Synthetic sample (not real data)");
    expect(a.columns).toEqual([
      "Invoice",
      "StockCode",
      "Description",
      "Quantity",
      "InvoiceDate",
      "Price",
      "Customer ID",
      "Country",
    ]);
    expect(a.rows.length).toBeGreaterThan(50_000);
    expect(a.rows.length).toBeLessThanOrEqual(150_000);
    expect(a.rows[0]![4]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it("includes cancellations, guest rows, non-product codes, duplicates and zero prices", () => {
    expect(a.rows.some((r) => r[0]!.startsWith("C") && Number(r[3]) < 0)).toBe(true);
    const missing = a.rows.filter((r) => r[6] === "").length / a.rows.length;
    expect(missing).toBeGreaterThan(0.12);
    expect(missing).toBeLessThan(0.25);
    expect(a.rows.some((r) => r[1] === "POST")).toBe(true);
    expect(a.rows.some((r) => r[5] === "0.00")).toBe(true);
    const seen = new Set<string>();
    let dup = 0;
    for (const r of a.rows) {
      const k = r.join("|");
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBeGreaterThan(0);
    const dates = a.rows.map((r) => r[4]!.slice(0, 10)).sort();
    expect(dates[0]!.startsWith("2023-01")).toBe(true);
    expect(dates[dates.length - 1]!.startsWith("2024-12")).toBe(true);
  });
});
