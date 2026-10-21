# UCI Online Retail II: data profile and 60-day base-rate check (Sprint Zero D6)

**Status: BLOCKED. No UCI numbers have been measured yet.** On 2026-10-21 the session's egress proxy refused the download from `archive.ics.uci.edu` (HTTP 403 on CONNECT, `connect_rejected`, which is a policy denial). Under the proxy rules, the download was not retried or fetched from a mirror. Every result section below is empty on purpose, because this report may only contain numbers produced by executed code against the real file. PRD Appendix C #1 (the 60-day base rate is between 15% and 70%) is **still unverified**.

The profiling script is written and was tested end-to-end on a synthetic fixture (23,309 generated rows, not UCI). Once the host is reachable, one command fills this report.

## Dataset and citation
- Chen, D. (2012). *Online Retail II* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D. Licensed under **CC BY 4.0** (attribution required; changes are documented in this report).
- Source: `https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip`
- Zip size / SHA-256: **not recorded (download blocked)**

## Reproduce (exact commands)
```bash
D=/tmp/claude-0/-home-user-AGENT-001/156c5987-c33f-5cf9-aa10-f6aa208a2a94/scratchpad/uci-data   # outside the repo
curl -sSL -o "$D/online_retail_ii.zip" https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip
stat -c %s "$D/online_retail_ii.zip"; sha256sum "$D/online_retail_ii.zip"
unzip -o "$D/online_retail_ii.zip" -d "$D"
cd /home/user/AGENT-001   # never run Python from inside the data directory
uv run --no-project --with pandas --with openpyxl --with pyarrow \
  python -I notebooks/profile_uci.py --data "$D" --out-json "$D/profile.json"
```
The first run reads both XLSX sheets and caches `online_retail_ii.parquet` in the data directory. Later runs read the cache.

## Method (PRD A.1, A.2, A.3, A.5; defaults `cancellation_mode=net`, §4.3 non-product list)
- **Parsing (A.1):** invoice IDs and stock codes are trimmed and upper-cased. Customer refs are trimmed, and `12345.0` becomes `12345`. Dates, quantities and prices are parsed with coercion, and anything that fails goes to R1.
- **Rules (in order; each is logged with rows and signed revenue for the rows still present when the rule runs):** R1 parse error → R2 missing customer → R3 exact duplicate on all 8 mapped fields (first copy kept) → R4 cancellation flag (`C` prefix or qty < 0, kept as negative revenue) → R5 price ≤ 0 on non-cancellation lines → R6 non-product codes `{POST, DOT, M, D, C2, CRUK, BANK CHARGES, AMAZONFEE, ADJUST, ADJUST2, TEST001, TEST002, PADS, B, S}` → R7 date > 2026-10-21 or < 1990-01-01 → R8 wholesale flag.
- **Reconciliation:** gross = Σ qty·price over parsed non-cancellation lines; cancellations = |Σ| over all parsed cancellation lines; excluded = signed Σ over rows removed by R2–R7; net = Σ over kept rows. The identity is checked in integer pence.
- **Purchase:** an invoice with ≥ 1 kept non-cancellation line and net invoice revenue > 0. Its date is the calendar date of the invoice.
- **Base rates:** for H ∈ {30, 60, 90}, using cutoffs on the 1st and 10th of each month from D_min + 180 d to D_max − H. Eligible means ≥ 1 purchase dated in [T − 365, T]. Positive means ≥ 1 purchase dated in (T, T + H]. A.5 cutoffs: T_test = D_max − H, T_val = T_test − H, and training cutoffs are monthly from D_min + 180 d to T_val − H.
- **Wholesale sensitivity (R8 at T, leakage-safe):** monetary is net revenue in [T − 365, T], compared with the p99 of eligible customers. Average quantity is per non-cancellation line over all history ≤ T. Flagged customers are removed from the eligible set.

### Interpretations of ambiguous rules
1. **R3 runs after R2,** so the duplicate count only covers rows that have a customer. The raw duplicate count is reported separately.
2. **R5 ignores cancellation lines.** A cancellation priced at 0 adds £0.
3. **R6 drops both product and cancellation lines** that have non-product codes. Alphabetic codes outside the list (for example `gift_0001_*`) are listed but kept.
4. **A cutoff T covers all of day T** (date-level comparison).
5. **The whole-history R8 count** (concentration section) uses p99 over all customers' net revenue across the full cleaned history.

## Results
**Not yet measured.** Each heading below gets filled in from `profile.json` after the run: raw profile (rows, columns, date range, distinct counts, top-10 countries, % missing Customer ID compared with UCI's "no missing values" claim, cancellations, price ≤ 0, non-product codes, duplicates); rule log R1–R8; reconciliation; concentration (top 1% and top 10% revenue share, wholesale count); base-rate table and min/median/max per H; A.5 cutoffs for H = 60; the no-wholesale sensitivity.

## Recommendation
**Deferred.** H = 60 stays the default until the measurement exists. The decision criteria are: base rate within about 15–70%; ≥ 30 positives at test, at validation and in the training union, with ≥ 200 eligible; and stability across cutoffs. If H = 60 fails, PRD Appendix C #1 names H = 90 as the fallback. That would be an analytic-definition change, so it would need an escalation and `/spec-change`.

## Limitations (known in advance; quantify after the run)
The data covers 2009–2011 and is in GBP, mostly from the UK. It is wholesale-heavy and comes from a single gift-ware retailer, so it is weak evidence for modern B2C e-commerce. The UCI metadata says there are no missing values, but other sources report about 20–25% of rows with no Customer ID; this run will confirm or correct that.
