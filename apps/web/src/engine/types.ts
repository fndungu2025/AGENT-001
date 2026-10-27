// FROZEN CONTRACT between the analytics engine (src/engine/**) and the UI (src/app/**).
// Money values are in currency units (e.g. GBP), rounded to 2 decimals. Dates are ISO strings
// (YYYY-MM-DD). Probabilities are 0..1. Definitions follow research/PRD.md Appendix A.
// Add OPTIONAL fields only; report any change to the orchestrator.
// Units (engine behaviour): fields named *Pct are 0-100 (rowsPct, missingCustomerPct, customersPct,
// revenuePct, sizePct); revenueShareTop1pct/10pct, repeatCustomerRate, probabilities and model
// metrics are 0-1. Cluster ids are 1-based; crosstab[segment][cluster - 1].

export type CanonicalField =
  | "invoice_id"
  | "invoice_ts"
  | "customer_ref"
  | "quantity"
  | "unit_price"
  | "stock_code"
  | "description"
  | "country";

export const REQUIRED_FIELDS: CanonicalField[] = [
  "invoice_id",
  "invoice_ts",
  "customer_ref",
  "quantity",
  "unit_price",
];

/** A parsed upload: header + rows of raw strings (values untrimmed). */
export interface RawTable {
  columns: string[];
  rows: string[][];
  /** True for generated demo data (must be labelled "synthetic" in the UI). */
  synthetic?: boolean;
  name: string;
}

export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export interface MappingSuggestion {
  field: CanonicalField;
  column: string | null;
  confidence: number; // 0..1
}

export interface AnalysisOptions {
  cancellationMode: "net" | "exclude";
  dateOrder: "auto" | "DMY" | "MDY";
  horizonDays: 30 | 60 | 90;
  /** Stock codes treated as non-product (postage, fees...). Defaults in engine. */
  nonProductCodes?: string[];
  excludeWholesale?: boolean;
}

export interface Progress {
  stage:
    | "parsing"
    | "cleaning"
    | "features"
    | "segmentation"
    | "training"
    | "evaluation"
    | "scoring"
    | "done";
  pct: number; // 0..100
  message: string;
}

// ---------- data quality (PRD F-03 AC7, A.2) ----------
export interface RuleLog {
  id: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8";
  description: string;
  rows: number;
  revenue: number;
}
export interface QualityReport {
  rowsRead: number;
  rowsKept: number;
  rules: RuleLog[];
  reconciliation: {
    gross: number;
    cancellations: number;
    excluded: number;
    net: number;
    /** net === gross + cancellations(negative) - excluded, to the penny */
    balances: boolean;
  };
  profile: {
    customers: number;
    invoices: number;
    products: number;
    dateMin: string;
    dateMax: string;
    topCountries: { country: string; rowsPct: number }[];
    revenueShareTop1pct: number;
    revenueShareTop10pct: number;
    wholesaleCustomers: number;
    missingCustomerPct: number;
  };
  warnings: { code: string; severity: "info" | "warning" | "error"; message: string }[];
}

// ---------- customers, segments, clusters ----------
export type SegmentKey =
  | "champions"
  | "cant_lose"
  | "loyal"
  | "high_value_infrequent"
  | "at_risk"
  | "new_promising"
  | "needs_attention"
  | "inactive";

export type RiskBand = "high_chance" | "medium" | "low_chance";

export interface Driver {
  feature: string;
  direction: "up" | "down";
  text: string; // plain-language sentence (PRD A.6)
}

export interface CustomerRow {
  id: string;
  country: string;
  lastOrder: string;
  firstOrder: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
  avgOrderValue: number;
  isWholesale: boolean;
  rfm: { r: number; f: number; m: number; score: string };
  segment: SegmentKey;
  cluster: number;
  pRepeat: number; // calibrated probability of a purchase within the horizon
  riskBand: RiskBand;
  expectedValue: number; // pRepeat * avgOrderValue
  drivers: Driver[]; // top 3
}

export interface SegmentSummary {
  key: SegmentKey;
  name: string;
  description: string;
  action: string;
  customers: number;
  customersPct: number;
  revenue: number;
  revenuePct: number;
  avgRecencyDays: number;
  avgFrequency: number;
  avgMonetary: number;
  avgPRepeat: number;
}

export interface ClusterSummary {
  cluster: number;
  name: string;
  size: number;
  sizePct: number;
  revenue: number;
  revenuePct: number;
  medianRecencyDays: number;
  medianFrequency: number;
  medianMonetary: number;
  avgPRepeat: number;
  /** most common RFM segment among members */
  dominantSegment: SegmentKey;
}

export interface KmeansDiagnostics {
  k: number;
  silhouette: number;
  tried: { k: number; inertia: number; silhouette: number }[];
  adjustedRandIndexVsRfm: number;
  /** counts: crosstab[segmentKey][clusterIndex] */
  crosstab: Record<string, number[]>;
}

// ---------- models (PRD F-08, F-09, A.5) ----------
export type ModelName = "baseline_recency" | "logreg" | "random_forest";

export interface ModelMetrics {
  nRows: number;
  nPositive: number;
  baseRate: number;
  rocAuc: number;
  prAuc: number;
  brier: number;
  logLoss: number;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  liftTop10: number;
  captureTop20: number; // share of actual repeaters found in the top 20% by score
}

export interface ModelResult {
  name: ModelName;
  label: string;
  validation: ModelMetrics;
  test: ModelMetrics;
  curves: {
    roc: [number, number][]; // [fpr, tpr]
    pr: [number, number][]; // [recall, precision]
    calibration: { predicted: number; observed: number; n: number }[];
    gain: [number, number][]; // [share of customers, share of repeaters captured]
  };
  importance: { feature: string; importance: number }[];
  /** test-set scores and labels for the client-side threshold slider (<= 20000 pairs) */
  testScores: { p: number; y: 0 | 1 }[];
  hyperparameters: Record<string, string | number>;
}

export interface Protocol {
  horizonDays: number;
  scoringDate: string; // last data date, features computed as of here for scoring
  testCutoff: string;
  validationCutoff: string;
  trainCutoffs: string[];
  eligibleAtScoring: number;
  trainRows: number;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  revenue: number;
  orders: number;
  customers: number;
}

export interface AnalysisResult {
  dataset: { name: string; synthetic: boolean };
  quality: QualityReport;
  protocol: Protocol | null; // null when prediction was skipped
  predictionSkipped?: { code: "INSUFFICIENT_DATA" | "INSUFFICIENT_HISTORY"; message: string };
  customers: CustomerRow[];
  segments: SegmentSummary[];
  clusters: ClusterSummary[];
  kmeans: KmeansDiagnostics | null;
  models: ModelResult[];
  selectedModel: ModelName | null;
  /** e.g. "model_gain_low" when no model beats the recency baseline by >= 0.01 PR-AUC */
  flags: string[];
  monthly: MonthlyPoint[];
  kpis: {
    activeCustomers: number;
    netRevenue12m: number;
    repeatCustomerRate: number;
    avgOrderValue: number;
    expectedRepeaters: number; // sum of pRepeat
    revenueAtRisk: number;
  };
  computedInMs: number;
}
