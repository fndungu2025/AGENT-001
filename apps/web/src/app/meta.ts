// Display metadata for segments and risk bands. Colours are a colour-blind-safe (Okabe-Ito based)
// set; every use also shows a text label, so colour is never the only signal.
import type { ClusterSummary, RiskBand, SegmentKey, SegmentSummary } from "../engine";

export interface SegmentMeta {
  key: SegmentKey;
  name: string;
  color: string;
  icon: string;
  blurb: string;
  action: string;
}

export const SEGMENTS: SegmentMeta[] = [
  {
    key: "champions",
    name: "Champions",
    color: "#0072B2",
    icon: "★",
    blurb: "Bought recently, often, and spend the most.",
    action: "Reward them and ask for reviews or referrals. Do not discount.",
  },
  {
    key: "loyal",
    name: "Loyal customers",
    color: "#009E73",
    icon: "♥",
    blurb: "Buy regularly and reliably.",
    action: "Offer loyalty perks and early access to new products.",
  },
  {
    key: "new_promising",
    name: "New & promising",
    color: "#56B4E9",
    icon: "✦",
    blurb: "Recent first buyers who could become regulars.",
    action: "Send a helpful second-purchase nudge within weeks.",
  },
  {
    key: "high_value_infrequent",
    name: "Big spenders, rare buyers",
    color: "#CC79A7",
    icon: "◆",
    blurb: "Spend a lot per order but order rarely.",
    action: "Suggest a bundle or a reorder reminder before their usual gap.",
  },
  {
    key: "needs_attention",
    name: "Needs attention",
    color: "#8A6D00",
    icon: "!",
    blurb: "Middle of the pack and slowly cooling.",
    action: "Run a gentle reminder with a relevant recommendation.",
  },
  {
    key: "at_risk",
    name: "At risk",
    color: "#E69F00",
    icon: "▲",
    blurb: "Used to buy often but have gone quiet.",
    action: "Send a win-back message with a personal touch.",
  },
  {
    key: "cant_lose",
    name: "Can't afford to lose",
    color: "#D55E00",
    icon: "⚠",
    blurb: "High-value customers who have gone quiet.",
    action: "Personal outreach (call or account manager) before they leave for good.",
  },
  {
    key: "inactive",
    name: "Inactive",
    color: "#6B7280",
    icon: "○",
    blurb: "Have not bought for a long time and rarely did.",
    action: "Low-cost last-chance email, then stop spending on them.",
  },
];

const SEGMENT_BY_KEY = new Map(SEGMENTS.map((s) => [s.key, s]));

export function segmentMeta(key: SegmentKey): SegmentMeta {
  return SEGMENT_BY_KEY.get(key) ?? (SEGMENTS[0] as SegmentMeta);
}
export function segmentName(key: SegmentKey, summaries?: SegmentSummary[]): string {
  return summaries?.find((s) => s.key === key)?.name ?? segmentMeta(key).name;
}
export function segmentAction(key: SegmentKey, summaries?: SegmentSummary[]): string {
  const fromEngine = summaries?.find((s) => s.key === key)?.action;
  return fromEngine && fromEngine.length > 0 ? fromEngine : segmentMeta(key).action;
}

export interface BandMeta {
  key: RiskBand;
  label: string;
  short: string;
  icon: string;
  pillClass: string;
  color: string;
  range: string;
}
export const BANDS: BandMeta[] = [
  {
    key: "high_chance",
    label: "High chance",
    short: "High",
    icon: "▲",
    pillClass: "pill-high",
    color: "#009E73",
    range: "60% or more",
  },
  {
    key: "medium",
    label: "Medium chance",
    short: "Medium",
    icon: "●",
    pillClass: "pill-medium",
    color: "#E69F00",
    range: "30% to 60%",
  },
  {
    key: "low_chance",
    label: "Low chance",
    short: "Low",
    icon: "▼",
    pillClass: "pill-low",
    color: "#D55E00",
    range: "under 30%",
  },
];
export function bandMeta(key: RiskBand): BandMeta {
  return BANDS.find((b) => b.key === key) ?? (BANDS[1] as BandMeta);
}

export const CLUSTER_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00"];
export function clusterLabel(c: Pick<ClusterSummary, "cluster" | "name">): string {
  return c.name.length > 0 ? c.name : `Group ${String(c.cluster + 1)}`;
}
