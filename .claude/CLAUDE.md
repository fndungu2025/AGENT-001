# CustomerIQ — Project Memory

<!-- Maintainer notes (HTML comments are stripped before Claude sees this file):
     - Keep this file under ~250 lines (Anthropic guidance: <200 lines → better adherence).
     - Put area-specific rules in .claude/rules/*.md with `paths:` frontmatter, not here.
     - Update "Current state" at the end of every work session. Last full review: 2026-10-21. -->

## 1. Project identity
- **CustomerIQ** is a customer behavior analytics and retention intelligence web app for online retailers. Users upload order history and get RFM segments, K-means clusters, and a calibrated **60-day repeat-purchase probability** per customer, each with a plain-language explanation.
- **Mission (two jobs):**
  1. A rigorous academic/portfolio project on the UCI Online Retail II dataset (working title: *Predicting Customer Purchasing Behavior and Developing Data-Driven Retention Strategies in E-Commerce*).
  2. A test of whether one niche will pay: **explainable repeat-purchase intelligence for SMB retailers with a large wholesale/B2B share that don't run on Klaviyo.**
- **Strategic verdict:** a generic commercial version is **NO-GO**, because Klaviyo, Shopify and Bloomreach already ship RFM and churn analytics. Do not build billing, connectors or SaaS scale-out until the month-3 decision gate passes (PRD §8.3).
- **Success criteria:**
  - Model: out-of-time test PR-AUC ≥ baseline + 0.03, and ROC-AUC ≥ 0.70. These are hypotheses; report honestly if not met.
  - Zero cross-tenant data leaks.
  - Upload-to-insight time ≤ 15 min.
  - Month 3: Sean Ellis PMF ≥ 40% and ≥ 3 willing-to-pay pilots.
- **Source of truth:** product requirements are in `research/PRD.md`. Feature IDs `F-01…F-26` are used in commits and PRs. The appendices define the analytics exactly. Background is in `research/viability-analysis.md` and `research/tech-stack.md`. Read the relevant PRD section before building any feature. These docs are *not* @-imported, to save context.

## 2. Technical context

### Stack
| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite SPA (not Next.js, not React Native). Tailwind v4 + shadcn/ui, Apache ECharts (`echarts-for-react`), TanStack Query/Table/Router, Zustand, React Hook Form + Zod, openapi-typescript/openapi-fetch |
| Backend | Python 3.12 + FastAPI (REST + OpenAPI), Pydantic v2, SQLAlchemy 2 + psycopg 3, uv |
| ML | pandas, NumPy, scikit-learn (KMeans, LogisticRegression, RandomForest, calibration), shap, pymc-marketing (BG/NBD, P1), pandera, joblib |
| Data | Supabase: Postgres 15+, Auth, Storage, Realtime, pg_cron, Queues |
| Hosting | **Netlify** (SPA, auto-deployed from GitHub `main`; PRs get Deploy Previews), Render (API + background worker), GitHub Actions (CI/CD, batch ML, nightly `pg_dump` → Cloudflare R2) |
| Dev research | Firecrawl MCP (web search/scrape for docs, competitors, pricing; never used at runtime, never given customer data) |
| Observability | Sentry (errors), PostHog (product analytics, no PII) |
| Email | Resend (via Supabase Auth SMTP and notifications) |
| Academic BI | Power BI Desktop reading `bi.*` views through a read-only role (F-19) |

### Key architectural decisions (do not reverse without approval)
1. **Python backend, not Node.js.** The ML ecosystem only exists in Python, and one backend is simpler than two.
2. **REST + OpenAPI, not tRPC or GraphQL.** tRPC requires a TypeScript backend. Types flow FastAPI → `openapi.json` → generated TS client.
3. **Supabase, not Firebase or MongoDB.** The data is relational and SQL-native, Power BI connects natively, there is no per-read billing, and it has an official MCP server.
4. **Multi-tenancy:** shared schema, `org_id` on every tenant row, Postgres **RLS** everywhere. The JWT carries an `org_id` claim through a custom access-token hook. Roles are `owner > admin > analyst > viewer`.
5. **Read/write split:**
   - The SPA reads tenant-scoped **views and RPCs directly through PostgREST** under RLS.
   - Anything that runs Python or changes state goes through **FastAPI**.
   - The browser never receives raw transactions.
6. **Heavy work is asynchronous.**
   - Uploads go browser → Supabase Storage through a signed URL, never through the API.
   - Runs are rows in `pipeline_runs`, claimed by the worker with `FOR UPDATE SKIP LOCKED`. Status goes to the UI through Realtime.
   - Never train models inside an HTTP request.
7. **Every analytic output is keyed by `run_id`.** Features are snapshotted at a cutoff date. Each org has an `active_run_id`. Results must be reproducible (`random_state=42`).
8. **Privacy by design.**
   - No names, emails, phones or addresses are stored. Email-like customer refs are HMAC-hashed on ingest.
   - Original uploads are deleted after 7 days.
9. **One definition per business rule.** Cleaning and revenue logic lives once in `packages/ml` and in DB views. The SPA, Power BI and notebooks only read those outputs.

### Coding standards and conventions
- **TypeScript:** `strict: true`, ESLint + Prettier (2 spaces), no `any`. Use function components and hooks, and keep logic in hooks so an Expo app could reuse it later. Server state lives in TanStack Query, filters in URL search params, small UI state in Zustand. Never use Redux.
- **Python:**
  - Ruff (lint + format, line length 100) and mypy strict on `apps/api` and `packages/ml`.
  - Type hints everywhere. Use Pydantic models at every boundary.
  - SQL must be parameterized. Never build it with f-strings.
- **SQL:** lowercase snake_case. Plural table names, except star-schema tables (`dim_*`, `fact_*`). Views are prefixed `v_`, materialized views `mv_`, RPC functions `rpc_`. Helper functions live in schema `app`.
- **API:**
  - `/v1` prefix, snake_case JSON, ISO-8601 UTC timestamps.
  - Money is sent as decimal **strings**.
  - Errors use RFC 9457 problem+json with a `code`.
  - Return 404 (not 403) for other orgs' resources.
- **Tests:**
  - Vitest + Testing Library for the web app; pytest for Python.
  - pgTAP tests for RLS (cross-tenant tests are a release gate).
  - Playwright with axe-core for E2E and accessibility.
  - Every ML change ships with a leakage test.
- **Accessibility:** WCAG 2.2 AA.
  - Every chart has a "View as table" alternative and an ECharts `aria` setting.
  - Colour is never the only signal.
  - Minimum width is 360 px, with no horizontal page scroll.
- **Git:**
  - Use small commits in imperative mood and reference feature IDs (for example `F-06: add RFM quintile scoring`).
  - Branches are `feature/F-xx-short-name`, or the branch assigned for the session.
  - Never commit secrets or `.env` files.
- **Copy:** use plain language first and the technical term second (for example, "Chance of buying again (60 days)").
- Area-specific rules live in `.claude/rules/` and load automatically when matching files are touched:
  - `ml-pipeline.md`: the leakage protocol and cleaning rules
  - `database.md`: migrations and RLS
  - `api.md`: the FastAPI service
  - `web.md`: the React SPA

## 3. Current state  ⟵ UPDATE THIS SECTION EVERY SESSION
**Last updated:** 2026-10-27 (browser analytics app shipped)

**Done**
- Research: `research/` holds the viability analysis, tech stack, PRD, skills (88), agents (20), roadmap and the UCI data-profile method.
- GitHub → Netlify: `netlify.toml` builds `site/` (docs viewer) from `main`. The user still has to import the repo in Netlify (production branch `main`).
- Sprint Zero (roadmap M0), verified locally on 2026-10-21:
  - Monorepo: pnpm (`apps/web`: Vite + React 18 + TS + Tailwind 4) and uv (`apps/api`: FastAPI; `packages/ml`: `customeriq`). Web lint, typecheck, test and build pass; ruff, mypy and pytest pass (33 tests).
  - CI: `.github/workflows/ci.yml` (web, python, db, gitleaks).
  - Schema v1 (`supabase/migrations/20261021020657_identity_tenancy.sql`): tenancy tables, RLS, profile trigger, access-token hook. 74 SQL assertions pass via `scripts/db/test-local.sh`. **Applied to the Supabase dev project `customeriq-dev` (ref `eddzbhytyegmsxkijsok`, eu-west-2, free)**; security advisor clean.
  - Auth scaffolding: `apps/api/app/deps/auth.py` (JWKS verification, `require_role`), 28 tests; SPA client `apps/web/src/lib/supabase.ts`.
  - Agent team installed: `.claude/agents/` (20), guard hooks `scripts/agent-guards/` (94 self-tests), `.claude/settings.json`, ledger, ADR-0001–0011.

- **Browser analytics app (live at the Netlify URL, ADR-0012):** `apps/web/src/engine/` (TypeScript engine in a Web Worker: parse, clean R1-R8, RFM, K-means, baseline/logreg/random forest, calibration, protocol A.5; 59 tests) and `apps/web/src/app/` (start, column mapping, running, 6-tab dashboard, how-it-works; 29 tests). Netlify builds with `scripts/build-netlify.sh`: app at `/`, research docs at `/research/`. Verified in a real browser with Netlify's CSP: sample data, CSV upload and two-sheet XLSX upload; no console errors.
- M1 (server-side data foundation) is partly built: migration `20261021025145_ingestion_curated.sql` (176 SQL assertions pass, not yet applied to the dev Supabase project) and the Python `parsing`/`schema`/`privacy` modules. Mapping, cleaning, quality report and worker are still to do; the TypeScript engine is currently the working implementation.

**In progress / next**
- Waiting on the user: Supabase dev project Auth settings (asymmetric JWT keys + access-token hook); branch protection on `main`.
- UCI data profile is **blocked** (network policy denies `archive.ics.uci.edu`). To run it: allow the host or upload the zip, then run the command in `research/data-profile-uci.md`; the browser app can also take the UCI file directly (CSV export; XLSX works but is slow for ~1M rows).
- Then continue roadmap M1-M4 (server-side product). Keep the TypeScript engine and `packages/ml` aligned with PRD Appendix A.

**Known issues / risks / tech debt**
- Browser engine deviations from the PRD model spec and its hashing choice are listed in ADR-0012.
- M1 follow-ups: FK `organizations.active_run_id` → `pipeline_runs`; DB-backed `MembershipChecker` (≤60 s cache); register `problem_error_handler` in `main.py`; index `invitations.invited_by/accepted_by` and `memberships.invited_by` (advisor INFO).
- **The UCI dataset has not been measured.** The user approved the download, but the network policy blocks the host. All dataset numbers in the PRD examples are placeholders.
- **`ucimlrepo.fetch_ucirepo(id=502)` is expected to fail** because the UCI API returns `data_url: null`. Download the zip from `https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip` and read both XLSX sheets with `openpyxl`.
- **UCI metadata claims "no missing values," which is wrong:** roughly 20–25% of rows have no Customer ID. The data is also wholesale-heavy, about 90% UK, from 2009–2011, and in GBP. State these limitations in every write-up.
- **Supabase free tier** pauses after 7 days idle and has no backups. Move to Pro before any external user. Render free tier has cold starts, so it is for demos only.
- **Open questions** are listed in PRD Appendix C (base rate, pilot export formats, email hashing acceptance, Power BI licence, pricing).

## 4. Agent instructions

### How to approach this codebase
- Start by reading §3 above, then the PRD section for the feature you're working on (search for `F-xx`).
- **Correct analytics matters more than features.** Follow PRD Appendix A (parsing, cleaning R1–R8, the 16 features, the RFM map, the evaluation protocol) exactly. If the spec seems wrong, raise it rather than quietly changing it.
- Build the smallest vertical slice that satisfies the acceptance criteria. Don't add P1/P2 scope to a P0 task.
- Before claiming something is done, run the checks: lint, typecheck, unit tests, pgTAP RLS tests and the leakage test. Report failures honestly, with their output.
- Use the MCP servers when available:
  - **Supabase:** SQL, migrations on a *dev* project, security/performance advisors, TS type generation.
  - **GitHub:** PRs and CI logs.
  - **Firecrawl:** current docs, competitor features and pricing (via the `web-researcher` agent).
  - **Playwright:** UI checks.
- Production database access through MCP is **read-only**.
- After meaningful progress, update §3 of this file in the same commit.

### Ask before making changes when:
- The PRD is silent or ambiguous about a behavior, metric definition, threshold or UI copy that users will see.
- A change would alter an **analytic definition**: cleaning rules, features, labels, cutoffs, the segment map, or model selection. These change every result, so check with the user and record the decision in the PRD.
- A schema change is destructive (dropping or renaming columns or tables), or a migration needs backfill.
- A change touches **RLS policies, auth, roles or storage policies**.
- You want to add a new dependency, service, paid tier, or anything that raises monthly cost (budget: under $50/mo until revenue).
- You would move work from P1/P2 into the MVP, or change the stack decisions in §2.

### Never do without explicit approval
- Commit secrets, `.env` files, service-role keys or customer data, or put the service-role key in frontend code or MCP config.
- Disable, weaken or bypass RLS, or write a service-role query without an explicit `org_id` filter.
- Store raw PII (names, emails, phones, addresses) or send customer-level data to Sentry, PostHog or any LLM or third party.
- Run destructive operations: `DROP` or `TRUNCATE` on non-staging tables, deleting Storage buckets, `supabase db reset` against a remote project, or force-pushing or rewriting shared git history.
- Apply migrations to **production**, change production environment variables, or deploy to production.
- Skip, disable or loosen tests (including leakage and cross-tenant tests) to get CI green.
- Use random train/test splits, fit any transform on data after the cutoff, or select a model using the test set.
- Download external datasets or large files, or call paid APIs.
- Open pull requests, push to `main`, or publish anything external (artifacts, comments, emails).
- Claim model performance numbers that weren't produced by an actual run.

## 5. File structure map (planned; ✅ = exists)
```
.claude/CLAUDE.md            ✅ this memory file
.claude/rules/               ✅ path-scoped rules (ml-pipeline, database, api, web)
research/                    ✅ viability-analysis.md, tech-stack.md, PRD.md (product source of truth), skills.md, agents.md
netlify.toml                 ✅ Netlify build config (today: docs site; later: apps/web)
scripts/build-site.sh        ✅ copies research docs + pinned viewer libs into site/
site/                        ✅ static docs viewer (index.html, app.js, styles.css, package.json); site/docs, site/vendor are build output
apps/web/                    React SPA (src/routes, src/features/<feature>, src/components/ui (shadcn),
                             src/lib/api (generated OpenAPI client), src/lib/supabase)
apps/api/                    FastAPI (app/main.py, app/routers/, app/services/, app/schemas/,
                             app/deps/auth.py, app/worker/ for the pipeline worker)
packages/ml/customeriq/      shared pipeline: parsing.py, cleaning.py, features.py, rfm.py,
                             clustering.py, models.py, evaluation.py, explain.py (+ tests/)
supabase/migrations/         timestamped SQL migrations (schema, RLS, views, RPCs)
supabase/tests/              pgTAP tests (RLS / cross-tenant)
supabase/seed/               demo-org seed config (UCI is fetched by the workflow, never committed)
sql/rfm_reference.sql        SQL RFM reference implementation (checked against pandas in CI)
notebooks/                   academic analysis; imports packages/ml, does not duplicate logic
bi/                          Power BI template (.pbit) + measures.md (DAX)
.github/workflows/           ci.yml, deploy.yml, e2e.yml, nightly.yml, seed-demo.yml
```
**Naming:**
- Python modules and files use `snake_case`.
- React components use `PascalCase.tsx`; hooks use `useThing.ts`.
- Feature folders mirror PRD features, e.g. `src/features/segments/`.
- Migrations use `YYYYMMDDHHMMSS_short_description.sql`.
- Tests: `test_*.py`, `*.test.ts(x)`, `*.spec.ts` (Playwright).

**Commands** (all verified 2026-10-21):
- Setup: `pnpm install && uv sync --all-packages`
- Web: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (root scripts delegate to `apps/web`)
- Python: `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`
- Database: `DATABASE_URL=postgresql://postgres@localhost:<port>/postgres bash scripts/db/test-local.sh` (plain Postgres 16; CI uses a `postgres:16` service)
- Agents: `python3 scripts/agent-guards/extract-agents.py --check`, `bash scripts/agent-guards/test.sh`
- Contract (planned, M2): `pnpm gen:api`

## 6. External dependencies
| Service | Purpose | Docs |
|---|---|---|
| Supabase | Postgres, Auth, Storage, Realtime, Cron, Queues, MCP | https://supabase.com/docs |
| Render | FastAPI web service + background worker | https://render.com/docs |
| Netlify | SPA hosting, auto-deployed from GitHub `main`; Deploy Previews per PR | https://docs.netlify.com/ |
| Cloudflare R2 | Off-site DB backups | https://developers.cloudflare.com/r2/ |
| Firecrawl | Dev-time web search/scrape via MCP (research, docs, competitor pricing) | https://docs.firecrawl.dev/mcp-server |
| GitHub Actions | CI/CD, nightly batch, `pg_dump`, demo seeding | https://docs.github.com/en/actions |
| Sentry | Error and performance monitoring (PII scrubbing on) | https://docs.sentry.io/ |
| PostHog | Product analytics (no PII; inputs masked) | https://posthog.com/docs |
| Resend | Auth and notification email | https://resend.com/docs |
| Google OAuth | Social sign-in (configured in the Supabase dashboard) | https://supabase.com/docs/guides/auth/social-login/auth-google |
| UCI Online Retail II | Demo and academic dataset (CC BY 4.0, DOI 10.24432/C5CG6D) | https://archive.ics.uci.edu/dataset/502/online+retail+ii |
| Power BI | Academic dashboard deliverable | https://learn.microsoft.com/en-us/power-bi/ |
| Core libraries | FastAPI · scikit-learn · pandas · React · TanStack · ECharts | https://fastapi.tiangolo.com/ · https://scikit-learn.org/stable/user_guide.html · https://pandas.pydata.org/docs/ · https://react.dev/ · https://tanstack.com/ · https://echarts.apache.org/ |

**Environment variables (names only; values live in Render, Netlify and GitHub secrets, or in a local `.env` that is never committed):**
- **Web (`apps/web`, public, `VITE_` prefix):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
- **API/worker (`apps/api`, secret):** `ENVIRONMENT`, `LOG_LEVEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `DATABASE_URL` (pooler, port 6543, transaction mode), `DATABASE_DIRECT_URL` (port 5432, for bulk `COPY`), `CORS_ALLOWED_ORIGIN_REGEX`, `SENTRY_DSN`, `RESEND_API_KEY`, `POSTHOG_API_KEY`
- **CI (GitHub secrets):** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `RENDER_DEPLOY_HOOK_URL`, `RENDER_API_KEY`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` (only if CI ever deploys via the Netlify CLI; the Git integration needs none), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`
- **Developer tooling (local, never committed):** `FIRECRAWL_API_KEY` (Firecrawl MCP; optional while the hosted connector is used).
- Keep a `.env.example` in each app listing these names with no values.

## 7. User avatar reminder
- **Jordan, the one-person analytics team:**
  - Works as a marketing/CRM analyst at a 10–150-person online retailer (£2M–£50M revenue, ≥15% repeat or wholesale revenue).
  - Strong in Excel, intermediate in SQL, not a Python user.
  - Today they spend ~9–13 hours a month on manual retention analysis.
  - **Fears being caught out by a wrong number in front of leadership.** Wants evidence, not black boxes, and wants to look credible.
- **Sam (the buyer):** the Head of Marketing or founder. Wants to know how much revenue is at risk and what saving it would return.
- **Dr. Rivera (the academic reviewer):** wants rigor, reproducibility, no leakage, and honest limitations.

**UX principles**
1. **Every number is traceable.** Show the run, cutoff date and dataset, and link to the data-quality report and definitions.
2. **Explain, don't just score.** Show the top drivers in plain language and the segment rule behind each group.
3. **Be honest about model quality.** Always compare against the simple baseline, and surface the `model_gain_low` flag plainly.
4. **Every view should lead to an action:** a suggested action per segment and a target list ready to export.
5. **Plain language first,** with the technical term on hover or as secondary text.
6. **Show the first insight within 15 minutes** of upload. Provide a demo workspace, smart column mapping and clear empty states.
7. **Design for desktop first and stay readable on a phone.** Upload and mapping are optimized for desktop.
