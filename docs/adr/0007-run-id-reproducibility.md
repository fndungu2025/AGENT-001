# ADR-0007: Every analytic output is keyed by `run_id` and reproducible

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §3 "Schema approach" design rules; `research/PRD.md`
  F-05 acceptance 5 and 8; `.claude/CLAUDE.md` §2 decision 7

## Context
Users must be able to trace every number (UX principle 1), the academic reviewer requires
reproducibility and no leakage, and re-runs must not overwrite past results silently.

## Decision
- Features, segments, predictions and metrics are written per **`run_id`**.
- Features are **snapshotted at a cutoff date** (no post-cutoff data in features).
- Each org has one `active_run_id`; dashboards default to it.
- `random_state=42` everywhere; library versions are stored in `pipeline_runs.environment`.
- Model files are versioned by `run_id` in Storage.

## Alternatives considered
- **Overwrite latest results in place:** simpler tables, but loses traceability and
  makes comparisons between runs impossible.

## Consequences
- Output tables carry `run_id` and `org_id` keys; storage grows with the number of runs.
- Every ML change ships with a leakage test.
