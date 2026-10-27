// Column mapping suggestions from header names (UCI, Shopify, WooCommerce and Excel styles).
import type { CanonicalField, MappingSuggestion } from "./types";

const SYNONYMS: Record<CanonicalField, string[]> = {
  invoice_id: [
    "invoice",
    "invoiceno",
    "invoicenumber",
    "invoiceid",
    "orderid",
    "ordernumber",
    "orderno",
    "ordernum",
    "order",
    "transactionid",
    "transaction",
    "receipt",
    "receiptnumber",
    "salesorder",
    "billno",
  ],
  invoice_ts: [
    "invoicedate",
    "orderdate",
    "date",
    "datetime",
    "timestamp",
    "transactiondate",
    "createdat",
    "purchasedate",
    "orderdatetime",
    "processedat",
    "dateplaced",
    "saledate",
    "time",
  ],
  customer_ref: [
    "customerid",
    "customer",
    "customerref",
    "customerreference",
    "customeremail",
    "email",
    "billingemail",
    "contactemail",
    "clientid",
    "client",
    "userid",
    "user",
    "buyer",
    "customerno",
    "customernumber",
    "custid",
    "accountid",
  ],
  quantity: [
    "quantity",
    "qty",
    "units",
    "lineitemquantity",
    "quantityordered",
    "orderquantity",
    "qtyordered",
    "count",
  ],
  unit_price: [
    "price",
    "unitprice",
    "unitcost",
    "itemprice",
    "lineitemprice",
    "priceeach",
    "saleprice",
    "sellingprice",
    "unitpricegbp",
    "rate",
  ],
  stock_code: [
    "stockcode",
    "sku",
    "productid",
    "productcode",
    "itemcode",
    "lineitemsku",
    "itemid",
    "partnumber",
    "article",
    "productsku",
  ],
  description: [
    "description",
    "productname",
    "product",
    "itemname",
    "title",
    "lineitemname",
    "itemdescription",
    "producttitle",
    "item",
  ],
  country: [
    "country",
    "billingcountry",
    "shippingcountry",
    "countrycode",
    "countryname",
    "shippingaddresscountry",
    "billingaddresscountry",
    "region",
  ],
};

export const FIELD_ORDER: CanonicalField[] = [
  "invoice_id",
  "invoice_ts",
  "customer_ref",
  "quantity",
  "unit_price",
  "stock_code",
  "description",
  "country",
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function score(field: CanonicalField, column: string): number {
  const c = norm(column);
  if (c === "") return 0;
  const syn = SYNONYMS[field];
  const i = syn.indexOf(c);
  if (i === 0) return 1;
  if (i > 0) return 0.9;
  let best = 0;
  for (const s of syn) {
    if (s.length < 4) continue;
    if (c.includes(s) || (c.length >= 4 && s.includes(c))) best = Math.max(best, 0.6);
  }
  return best;
}

export function suggestMappingFor(columns: string[]): MappingSuggestion[] {
  const cands: { field: CanonicalField; column: string; s: number }[] = [];
  for (const field of FIELD_ORDER) {
    for (const column of columns) {
      const s = score(field, column);
      if (s >= 0.5) cands.push({ field, column, s });
    }
  }
  cands.sort(
    (a, b) =>
      b.s - a.s ||
      FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) ||
      columns.indexOf(a.column) - columns.indexOf(b.column),
  );
  const usedField = new Set<CanonicalField>();
  const usedCol = new Set<string>();
  const picked = new Map<CanonicalField, { column: string; s: number }>();
  for (const c of cands) {
    if (usedField.has(c.field) || usedCol.has(c.column)) continue;
    usedField.add(c.field);
    usedCol.add(c.column);
    picked.set(c.field, { column: c.column, s: c.s });
  }
  return FIELD_ORDER.map((field) => {
    const p = picked.get(field);
    return { field, column: p?.column ?? null, confidence: p?.s ?? 0 };
  });
}
