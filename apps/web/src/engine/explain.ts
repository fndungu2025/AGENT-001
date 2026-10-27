/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// Plain-language driver sentences (PRD A.6) and feature labels.
import type { Driver } from "./types";
import { BASE_FEATURES, FEATURE_INDEX as F } from "./features";

export const FEATURE_LABELS: Record<string, string> = {
  recency_days: "Days since last order",
  frequency: "Orders in the past year",
  monetary: "Spend in the past year",
  tenure_days: "Days since first order",
  avg_order_value: "Average order value",
  avg_interpurchase_days: "Usual days between orders",
  std_interpurchase_days: "Variability of days between orders",
  recency_ratio: "Time since last order vs usual gap",
  orders_30d: "Orders in the last 30 days",
  orders_90d: "Orders in the last 3 months",
  orders_180d: "Orders in the last 6 months",
  revenue_90d: "Spend in the last 3 months",
  order_trend: "Change in ordering (last 3 months vs before)",
  distinct_products: "Different products bought",
  return_rate: "Share of spend returned or cancelled",
  is_wholesale: "Wholesale-style account",
  is_single_purchase: "Only one order so far",
  country: "Country",
};

export const GROUP_NAMES: string[] = [...BASE_FEATURES, "country"];

export interface DriverContext {
  /** the customer's NB base feature values */
  row: ArrayLike<number>;
  offset: number;
  segmentMedianRecency: number;
  country: string;
}

const n1 = (v: number): string => v.toFixed(1);
const n0 = (v: number): string => String(Math.round(v));
const plural = (v: number, one: string, many: string): string => (Math.round(v) === 1 ? one : many);

/** Render one driver sentence; wording follows the A.6 templates, with fallbacks for other features. */
export function renderDriver(feature: string, direction: "up" | "down", c: DriverContext): Driver {
  const v = (j: number): number => c.row[c.offset + j]!;
  let text: string;
  switch (feature) {
    case "recency_ratio": {
      const x = v(F.ratio);
      text =
        direction === "down"
          ? x >= 1
            ? `It's been ${n1(x)}× longer than this customer's usual gap between orders.`
            : `Time since the last order (${n1(x)}× the usual gap) lowers the likelihood.`
          : `Only ${n1(x)}× this customer's usual gap since the last order, so a repeat is on pace.`;
      break;
    }
    case "recency_days": {
      const x = v(F.recency);
      text =
        direction === "down"
          ? `No order for ${n0(x)} days (segment median: ${n0(c.segmentMedianRecency)}).`
          : `Ordered just ${n0(x)} days ago (segment median: ${n0(c.segmentMedianRecency)}).`;
      break;
    }
    case "orders_90d": {
      const x = v(F.o90);
      text =
        direction === "up"
          ? `${n0(x)} ${plural(x, "order", "orders")} in the last 3 months, more active than usual.`
          : `Only ${n0(x)} ${plural(x, "order", "orders")} in the last 3 months.`;
      break;
    }
    case "orders_30d": {
      const x = v(F.o30);
      text =
        direction === "up"
          ? `${n0(x)} ${plural(x, "order", "orders")} in the last 30 days shows current activity.`
          : `No recent activity: ${n0(x)} ${plural(x, "order", "orders")} in the last 30 days.`;
      break;
    }
    case "orders_180d": {
      const x = v(F.o180);
      text =
        direction === "up"
          ? `${n0(x)} ${plural(x, "order", "orders")} in the last 6 months raises the likelihood.`
          : `Only ${n0(x)} ${plural(x, "order", "orders")} in the last 6 months.`;
      break;
    }
    case "frequency": {
      const x = v(F.frequency);
      text =
        direction === "up"
          ? `A long history of ${n0(x)} orders raises the likelihood.`
          : `Only ${n0(x)} ${plural(x, "order", "orders")} in the past year lowers the likelihood.`;
      break;
    }
    case "order_trend": {
      const cur = v(F.o90);
      const prev = cur - v(F.trend);
      text =
        direction === "down"
          ? `Ordering less often than 3 months ago (${n0(prev)} → ${n0(cur)}).`
          : `Ordering more often than 3 months ago (${n0(prev)} → ${n0(cur)}).`;
      break;
    }
    case "return_rate": {
      const x = v(F.returnRate);
      text =
        direction === "down"
          ? `${Math.round(x * 100)}% of spend was returned or cancelled.`
          : "Very little spend was returned or cancelled.";
      break;
    }
    case "is_wholesale":
      text = "Buys in wholesale quantities; these accounts reorder on longer cycles.";
      break;
    case "is_single_purchase":
      text =
        direction === "down"
          ? "Only one order so far, so there is no ordering rhythm to rely on."
          : "Has ordered more than once, which gives a rhythm to rely on.";
      break;
    case "avg_interpurchase_days": {
      const x = v(F.avgIp);
      text =
        direction === "down"
          ? `Usually waits about ${n0(x)} days between orders, which lowers the chance in this window.`
          : `Usually orders about every ${n0(x)} days, which raises the chance in this window.`;
      break;
    }
    case "std_interpurchase_days":
      text =
        direction === "down"
          ? "Order timing is irregular, which makes the next order harder to predict."
          : "Order timing is irregular, but that still points toward a repeat.";
      break;
    case "tenure_days": {
      const x = v(F.tenure);
      text =
        direction === "up"
          ? `Customer for ${n0(x)} days, a long relationship raises the likelihood.`
          : `Customer for only ${n0(x)} days, a short relationship lowers the likelihood.`;
      break;
    }
    case "monetary":
    case "revenue_90d":
    case "avg_order_value":
    case "distinct_products": {
      const label = FEATURE_LABELS[feature]!.toLowerCase();
      text =
        direction === "up"
          ? `Higher ${label} than typical raises the likelihood.`
          : `Lower ${label} than typical lowers the likelihood.`;
      break;
    }
    case "country":
      text = `Based in ${c.country}; customers there reorder ${direction === "up" ? "more" : "less"} often than average.`;
      break;
    default:
      text = `${FEATURE_LABELS[feature] ?? feature} ${direction === "up" ? "raises" : "lowers"} the likelihood.`;
  }
  return { feature, direction, text };
}

/** Indices of the k largest |contribution| groups for row i of an n x G contribution matrix. */
export function topGroups(contrib: Float64Array, i: number, G: number, k: number): number[] {
  const idx = Array.from({ length: G }, (_, g) => g);
  idx.sort((a, b) => Math.abs(contrib[i * G + b]!) - Math.abs(contrib[i * G + a]!) || a - b);
  return idx.slice(0, k).filter((g) => contrib[i * G + g] !== 0);
}
