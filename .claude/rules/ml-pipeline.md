---
paths:
  - "packages/ml/**"
  - "apps/api/app/worker/**"
  - "notebooks/**"
  - "sql/**"
---
# ML pipeline rules (full spec: research/PRD.md Appendix A, F-04 to F-09)

## Leakage protocol (non-negotiable)
- Features at cutoff T use only rows with `invoice_ts <= T`. Label = ≥1 purchase in (T, T+H]. Default H = 60.
- Cutoffs:
  - `T_test = D_max - H`
  - `T_val = T_test - H`
  - Training cutoffs run monthly from `D_min + 180d` up to `T_val - H`.
- Fit on train, then tune and calibrate on validation. Report on test **once**. Never use the test set for any choice.
- Never use random splits. Fit scalers and encoders on training rows only.
- Scoring: refit the chosen config on all labeled cutoffs ≤ T_test, then score features computed at D_max.
- Every feature change needs a passing leakage test: perturbing rows after T must leave the feature matrix byte-identical.

## Cleaning (R1–R8, applied in this order and logged to `data_quality_reports`)
1. **R1:** exclude rows that fail to parse.
2. **R2:** exclude rows with a missing customer ref.
3. **R3:** exclude exact duplicates.
4. **R4:** a cancellation is an invoice starting with `C` or a quantity < 0. In `net` mode (the default), keep it as negative revenue, but never count it as a purchase.
5. **R5:** exclude rows with price ≤ 0.
6. **R6:** exclude non-product codes (POST, M, D, BANK CHARGES, AMAZONFEE, …).
7. **R7:** exclude future dates and dates before 1990.
8. **R8:** wholesale is a flag only: monetary ≥ p99 or average quantity per line > 50.
- **Purchase:** a distinct invoice with ≥1 kept non-cancellation line and positive net revenue.
- **Reconciliation must hold:** net = gross − cancellations − excluded (±0.01).

## Models and segmentation
- **Baseline:** recency-decile repeat rate. Every model must beat it, or the run is flagged `model_gain_low`.
- **logreg:** L2, `class_weight="balanced"`, C ∈ {0.01, 0.1, 1, 10}.
- **random_forest:** 300 trees, max_depth ∈ {6, 10, 14, None}, min_samples_leaf=20, `balanced_subsample`.
- **Calibration:** `CalibratedClassifierCV(cv="prefit")`. Isotonic if there are ≥1000 validation positives, otherwise sigmoid.
- **Selection:** highest validation PR-AUC. A tie within 0.005 goes to logreg.
- **K-means:** on `log1p` of R, F and M, then standardized. Try k = 3–8 with `n_init=10` and pick the best silhouette; reject any k with a cluster under 2%.
- **RFM:** quintiles via `rank(method="first")`. The segment map is PRD A.4 and is evaluated top to bottom.
- `random_state=42` everywhere. Record library versions in `pipeline_runs.environment`.
- Validate DataFrames with pandera at each stage boundary.
- Notebooks must import `customeriq.*` and never re-implement its logic.
