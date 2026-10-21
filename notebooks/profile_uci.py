"""Sprint Zero deliverable 6: UCI Online Retail II data profile and H-day base-rate check.

Applies PRD Appendix A.1 (parsing) and A.2 (cleaning rules R1-R8, in order; defaults:
cancellation_mode=net, non-product codes = PRD §4.3 org_settings default list), then measures
raw quality, revenue reconciliation, concentration, and repurchase base rates for
H in {30, 60, 90} on cutoffs dated the 1st and 10th of each month (plus the A.5 cutoffs).

Stdlib + pandas only (openpyxl is used by pandas to read the XLSX; pyarrow, if installed, to
cache Parquet). No data lives in the repo: pass the data location as an argument.

Usage (run from outside the data directory, with -I so nothing is imported from it):
    uv run --no-project --with pandas --with openpyxl --with pyarrow \
        python -I notebooks/profile_uci.py --data <dir-or-xlsx-or-parquet> [--out-json PATH]

NOTE: this is a Sprint Zero profiling script. When packages/ml/customeriq exists, the cleaning
and label logic here must be replaced by imports from customeriq.* (rules/ml-pipeline.md).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

NON_PRODUCT_CODES = {
    "POST",
    "DOT",
    "M",
    "D",
    "C2",
    "CRUK",
    "BANK CHARGES",
    "AMAZONFEE",
    "ADJUST",
    "ADJUST2",
    "TEST001",
    "TEST002",
    "PADS",
    "B",
    "S",
}  # PRD §4.3 org_settings.non_product_codes default
HORIZONS = (30, 60, 90)
LOOKBACK_DAYS = 365
MIN_HISTORY_DAYS = 180
WHOLESALE_PCTL = 0.99
WHOLESALE_AVG_QTY = 50
MIN_DATE = pd.Timestamp("1990-01-01")
RAW_COLS = [
    "Invoice",
    "StockCode",
    "Description",
    "Quantity",
    "InvoiceDate",
    "Price",
    "Customer ID",
    "Country",
]


# --------------------------------------------------------------------------- loading
def load_raw(data: Path) -> pd.DataFrame:
    """Load both XLSX sheets (concatenated). Caches a Parquet copy next to the XLSX."""
    if data.is_file() and data.suffix == ".parquet":
        return pd.read_parquet(data)
    xlsx = data if data.is_file() else next(iter(sorted(data.glob("*.xlsx"))), None)
    if xlsx is None:
        sys.exit(f"no .xlsx found in {data}")
    cache = xlsx.with_suffix(".parquet")
    if cache.exists():
        return pd.read_parquet(cache)
    sheets = pd.read_excel(xlsx, sheet_name=None, dtype=object, engine="openpyxl")
    df = pd.concat([s.assign(_sheet=name) for name, s in sheets.items()], ignore_index=True)
    try:
        df.astype(str).assign(_raw_index=range(len(df))).to_parquet(cache, index=False)
        df = pd.read_parquet(cache)  # identical string-typed frame on every run
    except ImportError:
        df = df.astype(str).assign(_raw_index=range(len(df)))
    return df


def _norm_text(s: pd.Series) -> pd.Series:
    out = s.astype("string").str.strip()
    return out.mask(out.isin(["", "nan", "None", "NaT", "<NA>"]))


def parse(raw: pd.DataFrame) -> pd.DataFrame:
    """PRD A.1: trim/upper-case invoice and stock codes, trim customer refs and normalize
    numeric refs ("12345.0" -> "12345"), parse dates and numbers."""
    df = pd.DataFrame(index=raw.index)
    df["invoice_id"] = _norm_text(raw["Invoice"]).str.upper()
    df["stock_code"] = _norm_text(raw["StockCode"]).str.upper()
    df["description"] = _norm_text(raw["Description"])
    cust = _norm_text(raw["Customer ID"])
    df["customer_ref"] = cust.str.replace(r"^(\d+)\.0+$", r"\1", regex=True)
    df["country"] = _norm_text(raw["Country"])
    df["quantity"] = pd.to_numeric(raw["Quantity"], errors="coerce")
    df["unit_price"] = pd.to_numeric(raw["Price"], errors="coerce")
    # The XLSX holds real Excel datetimes; the cache stores them as ISO strings.
    df["invoice_ts"] = pd.to_datetime(
        _norm_text(raw["InvoiceDate"]), format="ISO8601", errors="coerce"
    )
    df["line_revenue"] = df["quantity"] * df["unit_price"]
    return df


# --------------------------------------------------------------------------- cleaning
def clean(df: pd.DataFrame, now: pd.Timestamp) -> tuple[pd.DataFrame, list[dict]]:
    """Apply R1-R7 in order. Returns the kept rows and a per-rule log
    (rows/revenue affected among rows still present when the rule runs)."""
    log: list[dict] = []
    keep = pd.Series(True, index=df.index)
    df = df.copy()
    df["excluded_by"] = pd.Series(pd.NA, index=df.index, dtype="string")

    def apply(rule: str, mask: pd.Series, action: str) -> None:
        hit = mask & keep
        rev = df.loc[hit, "line_revenue"]
        log.append(
            {
                "rule": rule,
                "action": action,
                "rows": int(hit.sum()),
                "revenue": round(float(rev.sum(min_count=1) if hit.any() else 0.0), 2),
                "revenue_note": "signed sum of quantity*price of affected rows",
            }
        )
        if action == "exclude":
            df.loc[hit, "excluded_by"] = rule
            keep.loc[hit] = False

    r1 = df["invoice_ts"].isna() | df["quantity"].isna() | df["unit_price"].isna()
    apply("R1_parse_error", r1, "exclude")
    apply("R2_missing_customer", df["customer_ref"].isna(), "exclude")
    fields = [
        "invoice_id",
        "stock_code",
        "description",
        "quantity",
        "invoice_ts",
        "unit_price",
        "customer_ref",
        "country",
    ]
    dup = pd.Series(False, index=df.index)
    dup.loc[keep] = df.loc[keep, fields].duplicated(keep="first")
    apply("R3_exact_duplicate", dup, "exclude")
    df["is_cancellation"] = df["invoice_id"].str.startswith("C").fillna(False) | (
        df["quantity"] < 0
    )
    apply("R4_cancellation", df["is_cancellation"], "flag (net mode: kept as negative revenue)")
    apply("R5_price_le_0", (~df["is_cancellation"]) & (df["unit_price"] <= 0), "exclude")
    apply("R6_non_product", df["stock_code"].isin(NON_PRODUCT_CODES), "exclude")
    apply("R7_bad_date", (df["invoice_ts"] > now) | (df["invoice_ts"] < MIN_DATE), "exclude")
    return df.assign(kept=keep), log


def purchases_of(kept: pd.DataFrame) -> pd.DataFrame:
    """A purchase = distinct invoice with >=1 kept non-cancellation line and positive net
    invoice revenue. Purchase date = calendar date of the invoice's earliest timestamp."""
    g = kept.groupby("invoice_id").agg(
        customer_ref=("customer_ref", "first"),
        ts=("invoice_ts", "min"),
        net=("line_revenue", "sum"),
        n_noncanc=("is_cancellation", lambda s: int((~s).sum())),
        n_customers=("customer_ref", "nunique"),
    )
    p = g[(g["n_noncanc"] >= 1) & (g["net"] > 0)].copy()
    p["date"] = p["ts"].dt.normalize()
    return p.reset_index()


def wholesale_flags(lines: pd.DataFrame) -> pd.Series:
    """R8 on the given kept lines: net monetary >= p99 of all customers in lines
    OR mean quantity per non-cancellation line > 50."""
    monetary = lines.groupby("customer_ref")["line_revenue"].sum()
    p99 = monetary.quantile(WHOLESALE_PCTL)
    avg_qty = lines[~lines["is_cancellation"]].groupby("customer_ref")["quantity"].mean()
    avg_qty = avg_qty.reindex(monetary.index)
    return (monetary >= p99) | (avg_qty > WHOLESALE_AVG_QTY)


# --------------------------------------------------------------------------- base rates
def cutoff_grid(d_min: pd.Timestamp, d_max: pd.Timestamp, h: int) -> list[pd.Timestamp]:
    start, end = d_min + pd.Timedelta(days=MIN_HISTORY_DAYS), d_max - pd.Timedelta(days=h)
    months = pd.date_range(start.to_period("M").to_timestamp(), end, freq="MS")
    days = [m + pd.Timedelta(days=k) for m in months for k in (0, 9)]
    return [t for t in days if start <= t <= end]


def base_rate_at(
    p: pd.DataFrame, kept: pd.DataFrame, t: pd.Timestamp, h: int, drop_wholesale: bool
) -> dict:
    """Eligible: >=1 purchase with date in [T-365, T]. Positive: >=1 purchase in (T, T+H].
    Dates are calendar days; T includes the whole of day T."""
    win = p[(p["date"] >= t - pd.Timedelta(days=LOOKBACK_DAYS)) & (p["date"] <= t)]
    elig = pd.Index(win["customer_ref"].unique())
    n_ws = 0
    if drop_wholesale:
        hist = kept[kept["invoice_ts"].dt.normalize() <= t]
        mon_win = hist[hist["invoice_ts"].dt.normalize() >= t - pd.Timedelta(days=LOOKBACK_DAYS)]
        mon = mon_win.groupby("customer_ref")["line_revenue"].sum().reindex(elig).fillna(0.0)
        # R8 at T: monetary = net revenue in [T-365, T] (A.3), p99 over eligible customers;
        # avg quantity per non-cancellation line over all history <= T.
        mon_ws = mon >= mon.quantile(WHOLESALE_PCTL)
        avg_q = (
            hist[(~hist["is_cancellation"]) & hist["customer_ref"].isin(elig)]
            .groupby("customer_ref")["quantity"]
            .mean()
            .reindex(elig)
        )
        ws = mon_ws | (avg_q > WHOLESALE_AVG_QTY)
        n_ws = int(ws.sum())
        elig = elig[~ws.reindex(elig).fillna(False).to_numpy()]
    fut = p[(p["date"] > t) & (p["date"] <= t + pd.Timedelta(days=h))]
    pos = int(pd.Index(fut["customer_ref"].unique()).isin(elig).sum())
    n = len(elig)
    return {
        "T": t.date().isoformat(),
        "H": h,
        "eligible": n,
        "positives": pos,
        "base_rate": round(pos / n, 4) if n else None,
        "wholesale_removed": n_ws,
    }


def summarize(rows: list[dict]) -> dict:
    s = pd.Series([r["base_rate"] for r in rows], dtype=float)
    pos = pd.Series([r["positives"] for r in rows])
    return {
        "n_cutoffs": len(rows),
        "min": round(s.min(), 4),
        "median": round(s.median(), 4),
        "max": round(s.max(), 4),
        "std": round(s.std(ddof=1), 4) if len(s) > 1 else None,
        "min_positives": int(pos.min()),
        "min_eligible": int(min(r["eligible"] for r in rows)),
    }


def protocol_cutoffs(p, kept, d_min, d_max, h, drop_wholesale) -> dict:
    """PRD A.5: T_test = D_max - H, T_val = T_test - H, training monthly from D_min+180d to
    T_val - H inclusive (monthly = same day-of-month steps from T_min)."""
    t_test = d_max - pd.Timedelta(days=h)
    t_val = t_test - pd.Timedelta(days=h)
    t_min = d_min + pd.Timedelta(days=MIN_HISTORY_DAYS)
    train_ts, k = [], 0
    while (t := t_min + pd.DateOffset(months=k)) <= t_val - pd.Timedelta(days=h):
        train_ts.append(t)
        k += 1
    train = [base_rate_at(p, kept, t, h, drop_wholesale) for t in train_ts]
    return {
        "H": h,
        "D_min": d_min.date().isoformat(),
        "D_max": d_max.date().isoformat(),
        "test": base_rate_at(p, kept, t_test, h, drop_wholesale),
        "val": base_rate_at(p, kept, t_val, h, drop_wholesale),
        "train_cutoffs": train,
        "train_union": {
            "cutoffs": len(train),
            "rows": sum(r["eligible"] for r in train),
            "positives": sum(r["positives"] for r in train),
            "base_rate": round(
                sum(r["positives"] for r in train) / max(sum(r["eligible"] for r in train), 1), 4
            ),
        },
    }


# --------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--data",
        type=Path,
        required=True,
        help="directory holding the UCI .xlsx, the .xlsx itself, or a cached .parquet",
    )
    ap.add_argument("--out-json", type=Path, help="write all results as JSON here")
    ap.add_argument("--now", default="2026-10-21", help="R7 'future' reference date")
    args = ap.parse_args()

    raw = load_raw(args.data)
    df = parse(raw)
    res: dict = {"pandas_version": pd.__version__}

    # 1. raw profile
    rev = df["line_revenue"]
    canc_raw = df["invoice_id"].str.startswith("C").fillna(False) | (df["quantity"] < 0)
    countries = df["country"].value_counts()
    res["raw"] = {
        "rows": len(raw),
        "columns": [c for c in raw.columns if not c.startswith("_")],
        "sheets": raw["_sheet"].value_counts().to_dict() if "_sheet" in raw else None,
        "date_min": str(df["invoice_ts"].min()),
        "date_max": str(df["invoice_ts"].max()),
        "distinct_invoices": int(df["invoice_id"].nunique()),
        "distinct_customers": int(df["customer_ref"].nunique()),
        "distinct_stock_codes": int(df["stock_code"].nunique()),
        "distinct_countries": int(countries.size),
        "top10_countries_row_pct": {
            k: round(100 * v / len(df), 2) for k, v in countries.head(10).items()
        },
        "missing_customer_rows": int(df["customer_ref"].isna().sum()),
        "missing_customer_pct": round(100 * df["customer_ref"].isna().mean(), 2),
        "missing_by_column": {c: int(_norm_text(raw[c]).isna().sum()) for c in RAW_COLS},
        "cancellation_rows": int(canc_raw.sum()),
        "cancellation_row_pct": round(100 * canc_raw.mean(), 2),
        "cancellation_invoice_C_rows": int(
            df["invoice_id"].str.startswith("C").fillna(False).sum()
        ),
        "negative_qty_rows": int((df["quantity"] < 0).sum()),
        "cancellation_revenue": round(float(rev[canc_raw].sum()), 2),
        "positive_line_revenue": round(float(rev[~canc_raw].sum()), 2),
        "zero_price_rows": int((df["unit_price"] == 0).sum()),
        "negative_price_rows": int((df["unit_price"] < 0).sum()),
        "non_product_rows_by_code": df.loc[df["stock_code"].isin(NON_PRODUCT_CODES), "stock_code"]
        .value_counts()
        .to_dict(),
        "non_product_rows": int(df["stock_code"].isin(NON_PRODUCT_CODES).sum()),
        "other_alpha_stock_codes_top": df.loc[
            df["stock_code"].str.fullmatch(r"[A-Z _]+").fillna(False)
            & ~df["stock_code"].isin(NON_PRODUCT_CODES),
            "stock_code",
        ]
        .value_counts()
        .head(15)
        .to_dict(),
        "exact_duplicate_rows_raw": int(raw[RAW_COLS].duplicated(keep="first").sum()),
    }
    res["raw"]["cancellation_revenue_pct_of_positive"] = round(
        100 * abs(res["raw"]["cancellation_revenue"]) / res["raw"]["positive_line_revenue"], 2
    )

    # 2. cleaning + reconciliation
    cdf, log = clean(df, pd.Timestamp(args.now))
    res["rules"] = log
    kept = cdf[cdf["kept"]]
    cdf["excluded_by"] = cdf["excluded_by"].fillna("")
    parsed = cdf[cdf["excluded_by"] != "R1_parse_error"]
    gross = parsed.loc[~parsed["is_cancellation"], "line_revenue"].sum()
    canc = -parsed.loc[parsed["is_cancellation"], "line_revenue"].sum()
    excl = parsed.loc[~parsed["kept"], "line_revenue"].sum()
    excl_canc = parsed.loc[~parsed["kept"] & parsed["is_cancellation"], "line_revenue"].sum()
    net = kept["line_revenue"].sum()
    to_p = lambda x: round(x * 100)  # noqa: E731  (pence)
    res["reconciliation"] = {
        "definition": "gross = sum(qty*price) over parsed non-cancellation rows; cancellations = "
        "|sum| over all parsed cancellation rows; excluded = signed sum over rows "
        "excluded by R2-R7 (excluded cancellation rows enter with a negative "
        "sign); net = sum over kept rows",
        "gross": round(gross, 2),
        "cancellations": round(canc, 2),
        "excluded": round(excl, 2),
        "excluded_cancellation_part": round(excl_canc, 2),
        "kept_cancellations": round(
            -parsed.loc[parsed["is_cancellation"] & parsed["kept"], "line_revenue"].sum(), 2
        ),
        "excluded_by_rule": parsed.loc[~parsed["kept"]]
        .groupby("excluded_by")["line_revenue"]
        .sum()
        .round(2)
        .to_dict(),
        "net": round(net, 2),
        "net_minus_identity_pence": to_p(net) - (to_p(gross) - to_p(canc) - to_p(excl)),
        "holds_within_0.01": bool(abs(net - (gross - canc - excl)) <= 0.01),
        "kept_rows": len(kept),
        "kept_customers": int(kept["customer_ref"].nunique()),
    }

    # 3. concentration + wholesale (whole cleaned history)
    mon = kept.groupby("customer_ref")["line_revenue"].sum().sort_values(ascending=False)
    n = len(mon)
    ws = wholesale_flags(kept)
    res["concentration"] = {
        "customers": n,
        "total_net": round(mon.sum(), 2),
        "top1pct_n": max(1, round(0.01 * n)),
        "top10pct_n": max(1, round(0.10 * n)),
        "top1pct_share": round(mon.head(max(1, round(0.01 * n))).sum() / mon.sum(), 4),
        "top10pct_share": round(mon.head(max(1, round(0.10 * n))).sum() / mon.sum(), 4),
        "customers_nonpositive_net": int((mon <= 0).sum()),
        "wholesale_flagged": int(ws.sum()),
        "wholesale_by_monetary": int((mon >= mon.quantile(WHOLESALE_PCTL)).sum()),
        "wholesale_by_avg_qty": int(
            (
                kept[~kept["is_cancellation"]].groupby("customer_ref")["quantity"].mean()
                > WHOLESALE_AVG_QTY
            ).sum()
        ),
        "wholesale_revenue_share": round(
            mon[ws.reindex(mon.index).fillna(False)].sum() / mon.sum(), 4
        ),
    }

    # 4-5. base rates
    p = purchases_of(kept)
    res["purchases"] = {
        "n": len(p),
        "customers": int(p["customer_ref"].nunique()),
        "multi_customer_invoices": int((p["n_customers"] > 1).sum()),
    }
    d_min, d_max = kept["invoice_ts"].min().normalize(), kept["invoice_ts"].max().normalize()
    res["base_rates"], res["base_rates_no_wholesale"] = {}, {}
    res["protocol"], res["protocol_no_wholesale"] = {}, {}
    for h in HORIZONS:
        grid = cutoff_grid(d_min, d_max, h)
        for key, drop in (("base_rates", False), ("base_rates_no_wholesale", True)):
            rows = [base_rate_at(p, kept, t, h, drop) for t in grid]
            res[key][h] = {"rows": rows, "summary": summarize(rows)}
        res["protocol"][h] = protocol_cutoffs(p, kept, d_min, d_max, h, False)
        res["protocol_no_wholesale"][h] = protocol_cutoffs(p, kept, d_min, d_max, h, True)

    text = json.dumps(res, indent=2, default=str)
    if args.out_json:
        args.out_json.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
