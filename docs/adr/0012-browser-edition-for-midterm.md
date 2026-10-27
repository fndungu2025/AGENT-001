# ADR-0012: Ship a browser-only analytics edition first

- **Status:** Accepted, 2026-10-27 (user decision: a finished, deployed analytics app was needed the same day)
- **Supersedes in part:** the "full product first" scope (roadmap M1-M4); those milestones continue.

## Context
The full product (Supabase auth and tenancy, FastAPI, background worker) is about 7 weeks of work and
cannot run on Netlify (no Python runtime). A working analytics app was needed on the existing Netlify URL.

## Decision
Build the analytics as a TypeScript engine in `apps/web/src/engine/` that runs in a Web Worker in the user's
browser: CSV/XLSX parsing, cleaning rules R1-R8 with penny-exact reconciliation, RFM segments, K-means,
a recency baseline vs logistic regression vs random forest with validation-based calibration, and the
out-of-time protocol of PRD Appendix A.5. The UI is `apps/web/src/app/`. Netlify publishes the app at `/` and
the research documents at `/research/` (`scripts/build-netlify.sh`). No data leaves the browser.

## Alternatives considered
- Pyodide (reuse `packages/ml`): large downloads (tens of MB), slow start, CSP complications.
- Wait for the full backend: nothing deployable for weeks.

## Consequences
- Two implementations of the cleaning/analytics rules exist (Python in `packages/ml`, TypeScript in the engine).
  ADR-0009 (one definition per rule) is violated knowingly; the Python package remains the reference and the
  server-side product will reuse it. Keep them aligned when PRD Appendix A changes.
- Known deviations from the PRD model spec (documented, not hidden): random forest uses 120 trees with depth
  grid {6, 10} (PRD: 300 trees, {6, 10, 14, none}); logistic regression trains on at most 60k rows and applies
  signed log1p to 8 skewed features; validation ranking metrics use raw scores before calibration; the final
  refit includes the calibration snapshot, so forest probabilities may be slightly over-confident; random-forest
  per-customer drivers are a median-substitution approximation, not SHAP.
- Customer ids that look like emails are hashed with an unsalted SHA-256 truncated to 16 hex characters in the
  browser; low-entropy addresses could be brute-forced. Acceptable for a local-only demo; not for the server product.
- Real data: the UCI dataset could not be downloaded in the build environment (network policy). The app ships a
  clearly labelled synthetic sample; users upload their own files.
