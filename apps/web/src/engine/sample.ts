/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Deterministic SYNTHETIC demo dataset shaped like the UCI Online Retail II export: a UK gift
// wholesaler/retailer with heterogeneous buying rhythms, churners, cancellations, guest checkouts
// (no customer id), non-product codes, a few duplicates and zero-price rows.
// This is not real data. Behaviour is learnable but noisy by construction (random gaps, random
// lapses, drifting engagement and hidden "soft churn").
import { makeRng } from "./rng";
import type { Rng } from "./rng";
import type { RawTable } from "./types";
import { dayToIso, isoToDay } from "./values";

const START = "2023-01-01";
const END = "2024-12-31";
const N_CUSTOMERS = 3400;

const ADJ = [
  "VINTAGE",
  "RETRO",
  "WHITE",
  "RED",
  "BLUE",
  "PINK",
  "GREEN",
  "IVORY",
  "RUSTIC",
  "SPOTTY",
  "GLITTER",
  "HANGING",
  "MINI",
  "JUMBO",
  "CHRISTMAS",
  "LOVE",
  "GARDEN",
  "FOLKART",
  "ENAMEL",
  "WOODEN",
];
const NOUN = [
  "HEART T-LIGHT HOLDER",
  "MUG",
  "BUNTING",
  "LANTERN",
  "CUSHION COVER",
  "CAKE TIN",
  "STORAGE JAR",
  "BOX SET",
  "NOTEBOOK",
  "DOORSTOP",
  "PHOTO FRAME",
  "BAG",
  "TEAPOT",
  "BOTTLE",
  "WALL CLOCK",
  "ORNAMENT",
  "CANDLE",
  "COASTER SET",
  "TRAY",
  "APRON",
];
const COUNTRIES: [string, number][] = [
  ["United Kingdom", 0.9],
  ["Germany", 0.02],
  ["France", 0.02],
  ["EIRE", 0.015],
  ["Netherlands", 0.01],
  ["Spain", 0.008],
  ["Belgium", 0.007],
  ["Switzerland", 0.005],
  ["Portugal", 0.005],
  ["Norway", 0.004],
  ["Australia", 0.006],
];
const RETAIL_QTY = [1, 1, 2, 2, 3, 4, 6, 6, 12];
const WHOLESALE_QTY = [12, 24, 36, 48, 72, 96, 144];

type Kind = "weekly" | "monthly" | "seasonal" | "oneoff" | "occasional" | "wholesale";

interface Product {
  code: string;
  desc: string;
  price: number;
}

interface Line {
  p: Product;
  qty: number;
  /** wholesale lines are sold at a trade price (40% below list) */
  trade: boolean;
}
interface Evt {
  day: number;
  minute: number;
  cust: string; // "" for guest
  country: string;
  cancel: boolean;
  lines: Line[];
  extras: { code: string; desc: string; qty: number; price: number }[];
}

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[rng.int(arr.length)]!;
}

function pickCountry(rng: Rng): string {
  let u = rng.next();
  for (const [name, w] of COUNTRIES) {
    u -= w;
    if (u <= 0) return name;
  }
  return "United Kingdom";
}

function seasonFactor(day: number, kind: Kind): number {
  const month = new Date(day * 86_400_000).getUTCMonth(); // 0..11
  const q4 = month >= 8;
  if (kind === "seasonal") return q4 ? 0.35 : month >= 6 ? 1.2 : 2.2;
  return q4 ? 0.6 : month <= 5 ? 1.2 : 1;
}

function fmtTs(day: number, minute: number): string {
  const hh = String(8 + Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${dayToIso(day)} ${hh}:${mm}`;
}

export function generateSample(): RawTable {
  const rng = makeRng(20240101);
  const start = isoToDay(START);
  const end = isoToDay(END);
  const span = end - start;

  // product catalogue
  const products: Product[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 480; i++) {
    let code = String(20000 + rng.int(65000));
    if (rng.next() < 0.35) code += pick(["A", "B", "C"], rng);
    if (used.has(code)) continue;
    used.add(code);
    const price =
      Math.round(Math.min(32, Math.max(0.42, Math.exp(0.9 + 0.75 * rng.normal()))) * 100) / 100;
    products.push({ code, desc: `${pick(ADJ, rng)} ${pick(NOUN, rng)}`, price });
  }

  const evts: Evt[] = [];
  const linesFor = (wholesale: boolean): Line[] => {
    let n = wholesale ? 3 : 1;
    while (n < 14 && rng.next() < (wholesale ? 0.88 : 0.72)) n++;
    const lines: Line[] = [];
    for (let i = 0; i < n; i++) {
      lines.push({
        p: pick(products, rng),
        qty: wholesale ? pick(WHOLESALE_QTY, rng) : pick(RETAIL_QTY, rng),
        trade: wholesale,
      });
    }
    return lines;
  };
  const extrasFor = (wholesale: boolean): Evt["extras"] => {
    const ex: Evt["extras"] = [];
    if (rng.next() < (wholesale ? 0.25 : 0.1)) {
      ex.push({ code: "POST", desc: "POSTAGE", qty: 1 + rng.int(2), price: 18 });
    }
    if (rng.next() < 0.012) {
      ex.push({
        code: "M",
        desc: "Manual",
        qty: 1,
        price: Math.round((2 + rng.next() * 40) * 100) / 100,
      });
    }
    if (rng.next() < 0.004)
      ex.push({ code: "BANK CHARGES", desc: "Bank Charges", qty: 1, price: 15 });
    return ex;
  };

  for (let i = 0; i < N_CUSTOMERS; i++) {
    const id = String(12347 + i);
    const country = pickCountry(rng);
    const u = rng.next();
    const kind: Kind =
      u < 0.1
        ? "wholesale"
        : u < 0.16
          ? "weekly"
          : u < 0.44
            ? "monthly"
            : u < 0.6
              ? "seasonal"
              : u < 0.84
                ? "oneoff"
                : "occasional";
    const wholesale = kind === "wholesale";
    let mu: number;
    switch (kind) {
      case "weekly":
        mu = 9 + rng.next() * 8;
        break;
      case "monthly":
        mu = 24 + rng.next() * 24;
        break;
      case "seasonal":
        mu = 30 + rng.next() * 40;
        break;
      case "wholesale":
        mu = 18 + rng.next() * 40;
        break;
      default:
        mu = 70 + rng.next() * 90;
    }
    const startDay = rng.next() < 0.5 ? start + rng.int(90) : start + rng.int(span - 10);
    const lifespan = rng.next() < 0.38 ? 60 + rng.int(420) : Infinity; // hard churners
    const drift = 0.93 + rng.next() * 0.16; // <1 speeds up, >1 fades
    const softStop = 0.03 + rng.next() * 0.07; // hidden per-order stopping probability
    let day = startDay;
    let gapScale = 1;
    let orders = 0;
    const maxOrders = kind === "oneoff" ? (rng.next() < 0.8 ? 1 : 2) : 200;
    while (day <= end && day <= startDay + lifespan && orders < maxOrders) {
      evts.push({
        day,
        minute: rng.int(600),
        cust: id,
        country,
        cancel: false,
        lines: linesFor(wholesale),
        extras: extrasFor(wholesale),
      });
      orders++;
      if (rng.next() < 0.03 && kind !== "oneoff") {
        // occasional cancellation of part of this order a few days later
        const src = evts[evts.length - 1]!;
        const cday = day + 1 + rng.int(14);
        if (cday <= end) {
          evts.push({
            day: cday,
            minute: rng.int(600),
            cust: id,
            country,
            cancel: true,
            lines: src.lines.slice(0, 1 + rng.int(2)),
            extras: [],
          });
        }
      }
      if (rng.next() < softStop) break;
      gapScale *= drift;
      gapScale = Math.min(3, Math.max(0.5, gapScale));
      let gap = mu * gapScale * seasonFactor(day, kind) * Math.exp(0.6 * rng.normal() - 0.18);
      if (rng.next() < 0.14) gap *= 2.5 + rng.next() * 1.5; // random lapse
      day += Math.max(1, Math.round(gap));
    }
  }

  // guest checkouts: no customer id (about 17-20% of rows)
  const retailRows = evts.reduce((a, e) => a + e.lines.length, 0);
  let guestRows = 0;
  while (guestRows < retailRows * 0.22) {
    const d = start + rng.int(span + 1);
    const accept = seasonFactor(d, "monthly") < 1 ? 1 : 0.6;
    if (rng.next() > accept) continue;
    const lines = linesFor(false);
    guestRows += lines.length;
    evts.push({
      day: d,
      minute: rng.int(600),
      cust: "",
      country: pickCountry(rng),
      cancel: false,
      lines,
      extras: extrasFor(false),
    });
  }

  evts.sort((a, b) => a.day - b.day || a.minute - b.minute || a.cust.localeCompare(b.cust));

  const rows: string[][] = [];
  let invoice = 536_365;
  const emit = (e: Evt, inv: string, ts: string, prefix: boolean): void => {
    for (const l of e.lines) {
      const qty = prefix ? -l.qty : l.qty;
      // a few zero-price rows (free samples) and blank descriptions
      const zero = !prefix && rng.next() < 0.001;
      rows.push([
        inv,
        l.p.code,
        zero ? "" : l.p.desc,
        String(qty),
        ts,
        (zero ? 0 : Math.round(l.p.price * (l.trade ? 0.6 : 1) * 100) / 100).toFixed(2),
        e.cust,
        e.country,
      ]);
      if (!prefix && rng.next() < 0.001) rows.push(rows[rows.length - 1]!.slice()); // exact duplicate
    }
    for (const x of e.extras) {
      rows.push([
        inv,
        x.code,
        x.desc,
        String(prefix ? -x.qty : x.qty),
        ts,
        x.price.toFixed(2),
        e.cust,
        e.country,
      ]);
    }
  };
  for (const e of evts) {
    const inv = String(invoice++);
    emit(e, e.cancel ? `C${inv}` : inv, fmtTs(e.day, e.minute), e.cancel);
  }

  return {
    columns: [
      "Invoice",
      "StockCode",
      "Description",
      "Quantity",
      "InvoiceDate",
      "Price",
      "Customer ID",
      "Country",
    ],
    rows,
    name: "Synthetic sample (not real data)",
    synthetic: true,
  };
}
