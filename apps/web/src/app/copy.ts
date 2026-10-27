// All user-facing copy lives here. Plain language first, technical term second.
import type { CanonicalField, Progress } from "../engine";

export const DOCS_URL = "/research/";
export const UCI_URL = "https://archive.ics.uci.edu/dataset/502/online+retail+ii";
export const UCI_DOI = "10.24432/C5CG6D";

export const COPY = {
  appName: "CustomerIQ",
  tagline: "See which customers are likely to buy again, and what to do about it.",
  nav: { analytics: "Analytics", how: "How it works", docs: "Research & docs", main: "Main navigation" },
  skip: "Skip to main content",
  footer: {
    privacy: "Your data stays in your browser. Nothing is uploaded to a server.",
    uci: "Demo data source: UCI Online Retail II (CC BY 4.0), DOI 10.24432/C5CG6D.",
  },
  chart: {
    viewTable: "View as table",
    viewChart: "View as chart",
    failed: "The chart could not be drawn on this device. Use “View as table” instead.",
  },
  start: {
    heroTitle: "Know who will buy again, before they go quiet.",
    heroLead:
      "Load your order history and get customer groups, a chance-of-buying-again score for every customer, and a ready-to-use contact list. It takes a couple of minutes and needs no accounts.",
    privacy: "Your file never leaves your browser. All calculations run on this device.",
    stepsTitle: "How it works",
    steps: [
      { t: "Load your orders", d: "Upload a CSV or Excel export of order lines, or try the built-in sample." },
      { t: "Check the columns", d: "We guess which column is which. You confirm or fix it in one screen." },
      { t: "Get answers and actions", d: "Customer groups, who is likely to return, and a list you can export." },
    ],
    sampleTitle: "Try the sample data",
    sampleBadge: "Synthetic sample — not real customers",
    sampleBody:
      "A made-up shop with a couple of thousand customers, so you can explore every screen straight away.",
    sampleButton: "Try the sample data",
    uploadTitle: "Upload your orders (CSV or Excel)",
    uploadButton: "Choose a file",
    dropHint: "Drag and drop a file here, or choose one.",
    formats: "Accepted: .csv, .tsv, .txt, .xlsx. Up to about 100 MB. One row per order line.",
    needs:
      "You need: invoice number, order date, customer ID, quantity and unit price. Product code, description and country are optional but helpful.",
    realData: "Want real data to try?",
    realDataLink: "UCI Online Retail II (public dataset, DOI 10.24432/C5CG6D)",
    parsing: "Reading your file…",
    parseError: "We could not read that file.",
    parseErrorHelp:
      "Check that it is a CSV, TSV or Excel (.xlsx) file with a header row. Old .xls files need to be saved as .xlsx or CSV first.",
    badType: "That file type is not supported. Please use .csv, .tsv, .txt or .xlsx.",
    emptyFile: "That file has no rows to analyse.",
    sampleError: "The sample data could not be created.",
  },
  mapping: {
    title: "Check your columns",
    lead: "We matched your columns to what the analysis needs. Change any that look wrong.",
    required: "Required",
    optional: "Optional",
    notMapped: "— Not in my file —",
    confidence: (c: number) => (c >= 0.8 ? "Good match" : c >= 0.5 ? "Possible match" : c > 0 ? "Weak match" : "No match"),
    missing: (names: string[]) => `Still needed: ${names.join(", ")}.`,
    allSet: "All required columns are matched.",
    preview: "First 10 rows of your file",
    options: "Options",
    horizon: "Look-ahead window",
    horizonHelp: "How far ahead we estimate the chance of buying again.",
    cancellations: "Cancellations and returns",
    cancelNet: "Subtract them from revenue",
    cancelExclude: "Ignore cancelled orders",
    dateOrder: "Date order",
    dateAuto: "Detect automatically",
    dateDmy: "Day / month / year",
    dateMdy: "Month / day / year",
    wholesale: "Leave out wholesale customers",
    wholesaleHelp: "Removes unusually large, bulk-buying customers so retail shoppers are not drowned out.",
    run: "Run analysis",
    back: "Choose another file",
    rows: (n: string) => `${n} rows in this file`,
  },
  running: {
    title: "Analysing your customers",
    lead: "This runs on your device and usually takes under a minute. Please keep this tab open.",
    cancel: "Cancel",
    cancelled: "Analysis cancelled.",
    errorTitle: "The analysis could not finish",
    errorHelp:
      "Nothing was sent anywhere. You can go back and check the column choices, or try again.",
    retry: "Try again",
    backToMapping: "Back to column check",
    steps: [
      { stage: "parsing", label: "Reading rows" },
      { stage: "cleaning", label: "Cleaning data" },
      { stage: "features", label: "Building customer profiles" },
      { stage: "segmentation", label: "Grouping customers" },
      { stage: "training", label: "Training prediction models" },
      { stage: "evaluation", label: "Testing on a later period" },
      { stage: "scoring", label: "Scoring every customer" },
    ] satisfies { stage: Progress["stage"]; label: string }[],
  },
  results: {
    startOver: "Start over",
    switchSample: "Switch to the sample data",
    switchUpload: "Load my own file",
    synthetic: "SYNTHETIC",
    ctxDataset: "Dataset",
    ctxScoring: "Scoring date",
    ctxHorizon: "Look-ahead",
    ctxEligible: "Customers scored",
    ctxModel: "Model",
    noModel: "No prediction model",
    tabsLabel: "Results sections",
    tabs: {
      overview: "Overview",
      quality: "Data quality",
      segments: "Segments",
      customers: "Customers",
      predictions: "Predictions & methods",
      export: "Export",
    },
    syntheticBanner:
      "These customers are synthetic. They were generated for this demo, so none of the numbers describe a real business.",
  },
  kpi: {
    active: ["Active customers", "Customers with a recent order"],
    revenue: ["Net revenue, last 12 months", "After cancellations and returns"],
    repeat: ["Repeat-customer rate", "Share of customers who ordered more than once"],
    aov: ["Average order value", "Typical spend per order"],
    expected: ["Expected to buy again", "Customers we expect to order in the look-ahead window"],
    atRisk: ["Revenue at risk", "Last-12-month revenue from At-risk and Can't-lose customers with under 30% chance of returning"],
  },
  quality: {
    title: "Can I trust this data?",
    lead: "Before any analysis, we clean the file with eight fixed rules and check that the money adds up.",
    readKept: "Rows read and kept",
    rules: "Cleaning rules (R1–R8)",
    reconciliation: "Does the revenue add up?",
    balances: "Balances ✓ — gross, cancellations and exclusions reconcile to net revenue to the penny.",
    notBalances: "Does not balance ✗ — treat revenue totals with caution and check the file.",
    profile: "What is in the data",
    warnings: "Things to know",
    noWarnings: "No warnings. The data looks healthy.",
    meaning: "What this means",
    download: "Download data-quality report (CSV)",
  },
  segments: {
    title: "Customer groups",
    lead: "Two ways to group customers. RFM uses fixed, easy-to-explain rules. K-means finds natural groups from the numbers.",
    rfmTitle: "Groups by rules (RFM)",
    rfmHelp: "RFM = Recency (how recently), Frequency (how often), Monetary (how much). Each is scored 1 to 5.",
    clustersTitle: "Groups found by the data (K-means)",
    clustersHelp: "The computer looks for customers who behave alike. The names are our plain descriptions.",
    crosstab: "How the two methods compare",
    elbow: "How many groups fit best?",
    trust: "Which method should I trust?",
    trustBody:
      "Use the RFM groups for day-to-day actions: the rules are simple and you can explain them to anyone. Use the K-means groups as a second opinion. If the two broadly agree (agreement score near 1), you can be more confident. If they disagree, that is a clue that some customers behave differently from what recency, frequency and spend alone suggest.",
  },
  customers: {
    title: "Customers",
    search: "Search by customer ID",
    segment: "Segment",
    band: "Chance to buy again",
    country: "Country",
    wholesale: "Wholesale",
    minP: "Minimum chance",
    all: "All",
    any: "Any",
    yes: "Wholesale only",
    no: "Retail only",
    results: (n: string) => `${n} customers match`,
    caption: "Customers with chance of buying again",
    detailsTitle: "Customer details",
    drivers: "Why this score?",
    noDrivers: "No explanation is available for this customer.",
    noPrediction: "Predictions were not produced for this dataset, so chances are not available.",
  },
  predictions: {
    title: "Predictions & methods",
    summaryTitle: "In plain words",
    protocolTitle: "How we tested it",
    protocolPoints: [
      "No random splits. The model learns from the past and is tested on a later period it has never seen.",
      "Customer profiles are built only from information available before each cut-off date.",
      "The model is chosen using a validation period, never the test period.",
    ],
    metricsTitle: "How good is each model?",
    metricsHelp: "A model only counts if it beats the simple rule “customers who ordered most recently are most likely to return”.",
    validation: "Validation period",
    test: "Test period",
    importanceTitle: "What matters most to the model",
    thresholdTitle: "Try a cut-off",
    thresholdHelp: "Move the slider to choose who counts as “likely to buy again”. Numbers update using the test-period results.",
    gainLowTitle: "The model adds little over a simple rule",
    gainLowBody:
      "On this data, the machine-learning models were not clearly better than the recency rule. Scores use the simple rule, so treat them as a sorted list, not as precise probabilities. This is an honest result, not a failure of the tool.",
    skippedTitle: "Predictions were skipped",
    limitsTitle: "Limitations",
    limits: [
      "Correlation, not causation: the score says who tends to buy again, not what makes them buy.",
      "Wholesale skew: a small number of bulk buyers can account for most revenue and shape every result.",
      "Expected uplift from a campaign is assumed, not measured. Use a holdout group to measure it.",
      "Results describe the file you loaded, for the period it covers. They may not hold for other periods or shops.",
    ],
    syntheticLimit:
      "This is synthetic demo data. Do not draw business conclusions from these results.",
    noModels: "No models are available for this dataset.",
  },
  exportTab: {
    title: "Export a target list",
    lead: "Choose who you want to reach, check the count, then download a CSV you can open in Excel or load into your email tool.",
    segment: "Segment",
    band: "Chance to buy again",
    minP: "Minimum chance to buy again",
    preview: (n: string) => `${n} customers in this list`,
    download: "Download CSV",
    empty: "No customers match these choices.",
    safety:
      "Cells that start with =, +, - or @ are prefixed with an apostrophe so spreadsheets cannot run them as formulas.",
    nextStep: "Suggested action",
  },
  how: {
    title: "How it works",
    lead: "A short, plain-language guide to what the numbers mean and how far you can trust them.",
  },
} as const;

export const FIELD_LABELS: Record<CanonicalField, { label: string; help: string; required: boolean }> = {
  invoice_id: { label: "Invoice or order number", help: "Identifies one order", required: true },
  invoice_ts: { label: "Order date", help: "When the order happened", required: true },
  customer_ref: { label: "Customer ID", help: "Who placed the order. Emails are hashed in your browser.", required: true },
  quantity: { label: "Quantity", help: "Units on the line (negative for returns)", required: true },
  unit_price: { label: "Unit price", help: "Price of one unit", required: true },
  stock_code: { label: "Product code", help: "Used to spot postage and fees", required: false },
  description: { label: "Product description", help: "Used to spot non-product lines", required: false },
  country: { label: "Country", help: "Used for the country chart and filter", required: false },
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

export const FEATURE_LABELS: Record<string, string> = {
  recency_days: "Days since last order",
  frequency: "Number of orders",
  monetary: "Total spend",
  avg_order_value: "Average order value",
  tenure_days: "Time as a customer",
  avg_gap_days: "Usual gap between orders",
};
export function featureLabel(f: string): string {
  return FEATURE_LABELS[f] ?? f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const MODEL_LABELS: Record<string, string> = {
  baseline_recency: "Simple rule (most recent buyers first)",
  logreg: "Logistic regression",
  random_forest: "Random forest",
};

export const RULE_MEANING: Record<string, string> = {
  R1: "Rows with a date, quantity or price we could not read are left out.",
  R2: "Rows without a customer ID cannot be linked to a person, so they are left out of customer analysis (their revenue is still counted in the reconciliation).",
  R3: "Exact duplicate lines are counted once.",
  R4: "Cancellations and returns reduce revenue (or are ignored, depending on your option) and never count as a purchase.",
  R5: "Lines with a zero or negative price (free samples, adjustments) are not real sales, so they are left out.",
  R6: "Postage, fees, discounts and similar non-product lines are left out of revenue.",
  R7: "Orders dated in the future or before 1990 are treated as errors and left out.",
  R8: "Very large bulk buyers are flagged as wholesale. They stay in unless you choose to leave them out.",
};
