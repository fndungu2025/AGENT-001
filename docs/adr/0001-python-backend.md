# ADR-0001: Python backend (FastAPI), not Node.js

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §2 "Runtime and framework"; `.claude/CLAUDE.md` §2 decision 1

## Context
CustomerIQ's core value is analytics: cleaning 1M+ row Excel uploads, RFM, K-means,
logistic regression / random forest with calibration, SHAP explanations and (P1) BG/NBD.
The same code must run in academic notebooks and in production.

## Decision
One backend, in **Python 3.12 + FastAPI** (Pydantic v2, SQLAlchemy 2 + psycopg 3, uv).
The ML pipeline lives in `packages/ml` and is imported by the API, worker and notebooks.

## Alternatives considered
- **Node.js / TypeScript backend:** no mature equivalent of pandas, scikit-learn,
  pymc-marketing or shap. Python would still be needed for ML, i.e. two backends.
- **Next.js server routes:** a third runtime to host and pay for, with the same ML gap.

## Consequences
- End-to-end types need a cross-language contract (see ADR-0002), not tRPC.
- Ruff + mypy strict and pytest are the Python quality gates.
- Heavy jobs need more memory than a 512 MB Render Starter instance; run them on
  GitHub Actions or a larger worker (see ADR-0006).
