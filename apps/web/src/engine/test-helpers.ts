// Shared helpers for engine tests.
import type { ColumnMapping, RawTable } from "./types";

export const COLUMNS = [
  "Invoice",
  "StockCode",
  "Description",
  "Quantity",
  "InvoiceDate",
  "Price",
  "Customer ID",
  "Country",
];

export const MAPPING: ColumnMapping = {
  invoice_id: "Invoice",
  stock_code: "StockCode",
  description: "Description",
  quantity: "Quantity",
  invoice_ts: "InvoiceDate",
  unit_price: "Price",
  customer_ref: "Customer ID",
  country: "Country",
};

/** [invoice, stock, qty, date, price, customer, country?] */
export type Tup = [string, string, number | string, string, number | string, string, string?];

export function table(rows: Tup[], name = "test"): RawTable {
  return {
    columns: COLUMNS,
    rows: rows.map(([inv, stock, qty, date, price, cust, country]) => [
      inv,
      stock,
      "ITEM",
      String(qty),
      date,
      String(price),
      cust,
      country ?? "United Kingdom",
    ]),
    name,
  };
}
