/* eslint-disable @typescript-eslint/no-non-null-assertion -- indexed access on typed arrays/fixed tables is bounds-checked by construction; numbers in messages are intentional */
// RFM quintile scores and the eight rule-based segments (PRD F-06, A.4).
import type { SegmentKey, SegmentSummary } from "./types";

export const SEGMENT_ORDER: SegmentKey[] = [
  "champions",
  "cant_lose",
  "loyal",
  "high_value_infrequent",
  "at_risk",
  "new_promising",
  "needs_attention",
  "inactive",
];

export const SEGMENT_INFO: Record<
  SegmentKey,
  { name: string; description: string; action: string; rule: string }
> = {
  champions: {
    name: "Champions",
    description: "Bought recently, buy often, spend the most",
    action: "Reward and retain; early access; don't discount unnecessarily",
    rule: "Recency, frequency and spend scores all 4 or 5",
  },
  cant_lose: {
    name: "Can't lose them",
    description: "Former top customers who have gone quiet",
    action: "Urgent personal win-back; find out why they stopped",
    rule: "Recency score 1-2, frequency and spend scores 4-5",
  },
  loyal: {
    name: "Loyal",
    description: "Regular repeat buyers",
    action: "Loyalty perks, cross-sell, ask for reviews and referrals",
    rule: "Frequency score 4-5 and recency score 3 or more",
  },
  high_value_infrequent: {
    name: "High-value, infrequent",
    description: "Spend a lot per order but buy rarely (often wholesale or seasonal)",
    action: "Time outreach to their usual buying cycle; personal account contact",
    rule: "Spend score 4-5 and frequency score 1-2",
  },
  at_risk: {
    name: "At risk",
    description: "Valuable customers who are slipping away",
    action: "Targeted win-back with a reason to return",
    rule: "Recency score 1-2 and (frequency or spend score 3 or more)",
  },
  new_promising: {
    name: "New / promising",
    description: "Recent first or second-time buyers",
    action: "Onboarding sequence; encourage the second purchase",
    rule: "Recency score 4-5 and frequency score 1-2",
  },
  needs_attention: {
    name: "Needs attention",
    description: "Average customers drifting toward inactivity",
    action: "Re-engage with relevant products; limited-time offer",
    rule: "Recency score 3",
  },
  inactive: {
    name: "Inactive",
    description: "Low value, haven't bought in a long time",
    action: "Low-cost automated reactivation, or suppress to save budget",
    rule: "Everything else",
  },
};

/** First match wins, evaluated top to bottom (A.4). */
export function segmentFor(r: number, f: number, m: number): SegmentKey {
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (r <= 2 && f >= 4 && m >= 4) return "cant_lose";
  if (f >= 4 && r >= 3) return "loyal";
  if (m >= 4 && f <= 2) return "high_value_infrequent";
  if (r <= 2 && (f >= 3 || m >= 3)) return "at_risk";
  if (r >= 4 && f <= 2) return "new_promising";
  if (r === 3) return "needs_attention";
  return "inactive";
}

/**
 * Quintile scores 1..5 via rank(method="first"): ties are broken by input order, so the five
 * groups are as equal as possible. `ascendingIsBetter` reverses the score (recency).
 */
export function quintileScores(values: ArrayLike<number>, reverse: boolean): Uint8Array {
  const n = values.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Uint8Array(n);
  for (let rank = 0; rank < n; rank++) {
    const q = Math.floor((rank * 5) / n); // 0..4
    out[sorted[rank]!] = reverse ? 5 - q : q + 1;
  }
  return out;
}

export interface RfmInput {
  recency: ArrayLike<number>;
  frequency: ArrayLike<number>;
  monetary: ArrayLike<number>;
}

export interface RfmResult {
  r: Uint8Array;
  f: Uint8Array;
  m: Uint8Array;
  segment: SegmentKey[];
}

export function computeRfm(x: RfmInput): RfmResult {
  const r = quintileScores(x.recency, true);
  const f = quintileScores(x.frequency, false);
  const m = quintileScores(x.monetary, false);
  const segment = new Array<SegmentKey>(r.length);
  for (let i = 0; i < r.length; i++) segment[i] = segmentFor(r[i]!, f[i]!, m[i]!);
  return { r, f, m, segment };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface SegmentAggInput {
  segment: SegmentKey[];
  recency: ArrayLike<number>;
  frequency: ArrayLike<number>;
  monetary: ArrayLike<number>;
  pRepeat: ArrayLike<number>;
}

export function summariseSegments(x: SegmentAggInput): SegmentSummary[] {
  const n = x.segment.length;
  let totalRev = 0;
  for (let i = 0; i < n; i++) totalRev += x.monetary[i]!;
  return SEGMENT_ORDER.map((key) => {
    let c = 0;
    let rev = 0;
    let rec = 0;
    let freq = 0;
    let p = 0;
    for (let i = 0; i < n; i++) {
      if (x.segment[i] !== key) continue;
      c++;
      rev += x.monetary[i]!;
      rec += x.recency[i]!;
      freq += x.frequency[i]!;
      p += x.pRepeat[i]!;
    }
    const info = SEGMENT_INFO[key];
    return {
      key,
      name: info.name,
      description: info.description,
      action: info.action,
      customers: c,
      customersPct: n > 0 ? round2((c / n) * 100) : 0,
      revenue: round2(rev),
      revenuePct: totalRev > 0 ? round2((rev / totalRev) * 100) : 0,
      avgRecencyDays: c > 0 ? round2(rec / c) : 0,
      avgFrequency: c > 0 ? round2(freq / c) : 0,
      avgMonetary: c > 0 ? round2(rev / c) : 0,
      avgPRepeat: c > 0 ? Math.round((p / c) * 10_000) / 10_000 : 0,
    };
  });
}
