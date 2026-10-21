# CustomerIQ

Customer behavior analytics and retention intelligence for online retailers. Upload order history
and get RFM segments, K-means clusters and a calibrated 60-day repeat-purchase probability per
customer, each with a plain-language explanation.

Status: **Sprint Zero** (scaffold only, no product features yet). See
[`research/roadmap.md`](research/roadmap.md) for the plan.

## Docs

- [`research/PRD.md`](research/PRD.md): product requirements (source of truth, features F-01…F-26)
- [`research/tech-stack.md`](research/tech-stack.md): stack, hosting, CI/CD, costs
- [`research/roadmap.md`](research/roadmap.md): milestones and Sprint Zero checklist
- [`research/viability-analysis.md`](research/viability-analysis.md): academic and commercial verdict
- [`research/agents.md`](research/agents.md): Claude Code agent team
- [`.claude/CLAUDE.md`](.claude/CLAUDE.md): conventions and project memory

## Layout

| Path | What |
|---|---|
| `apps/web` | React 18 + TypeScript + Vite SPA (Tailwind v4, Vitest) |
| `apps/api` | FastAPI service, Python 3.12 (import as `app`) |
| `packages/ml` | Shared analytics pipeline (import as `customeriq`) |
| `supabase/` | SQL migrations and SQL tests |
| `.github/workflows/ci.yml` | CI: web, python, db, secrets |

## Setup

Prerequisites: Node 22 (`.nvmrc`), pnpm 10, [uv](https://docs.astral.sh/uv/) (installs Python 3.12
from `.python-version`), and `psql` + a local Postgres 16 for the database tests.

```bash
pnpm install && uv sync --all-packages
cp apps/web/.env.example apps/web/.env.local   # fill in values; never commit .env files
cp apps/api/.env.example apps/api/.env
```

## Commands

```bash
# Web (from the repo root; delegates to apps/web)
pnpm dev | pnpm lint | pnpm typecheck | pnpm test | pnpm build

# Python (API + ML)
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
uv run uvicorn app.main:app --reload --app-dir apps/api   # GET /v1/health

# Database (migrations + SQL tests against a throwaway database)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/db/test-local.sh
```

CI runs all of the above on every pull request and on pushes to `main` and `claude/**`.
