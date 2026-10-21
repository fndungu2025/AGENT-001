# ADR-0009: One definition per business rule

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §3 "Schema approach" design rules; `.claude/CLAUDE.md` §2 decision 9

## Context
The same figures appear in the SPA, Power BI, notebooks and ad-hoc SQL. Duplicated
cleaning or revenue logic would make them disagree, and users fear being caught out by a
wrong number.

## Decision
Cleaning and revenue logic is written **once**, in `packages/ml` (Python pipeline) and in
database views. The SPA, Power BI and notebooks only **read** those outputs; notebooks
import `packages/ml` instead of re-implementing logic. The SQL RFM reference
(`sql/rfm_reference.sql`) exists only as a parity check against pandas in CI.

## Alternatives considered
- **Per-consumer logic (DAX measures, notebook code, frontend calculations):** faster to
  start, but definitions drift.

## Consequences
- Changing an analytic definition is an escalation to the user and a PRD change (`/spec-change`).
- Consumers depend on stable view names (`v_*`, `mv_*`) and `bi.*` views.
