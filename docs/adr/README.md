# Architecture Decision Records

Owner: `architect` agent (research/agents.md §4.3). Template: Status, Context, Decision,
Alternatives considered, Consequences. Reversing an accepted ADR requires the user's
approval (CLAUDE.md §2 "do not reverse without approval").

| ADR | Title | Status |
|---|---|---|
| [0001](0001-python-backend.md) | Python backend (FastAPI), not Node.js | Accepted, 2026-10-21 |
| [0002](0002-rest-openapi.md) | REST + OpenAPI, not tRPC or GraphQL | Accepted, 2026-10-21 |
| [0003](0003-supabase.md) | Supabase (Postgres), not Firebase or MongoDB | Accepted, 2026-10-21 |
| [0004](0004-multitenancy-rls.md) | Shared-schema multi-tenancy with `org_id` + RLS | Accepted, 2026-10-21 |
| [0005](0005-read-write-split.md) | Read/write split: PostgREST reads, FastAPI for Python and writes | Accepted, 2026-10-21 |
| [0006](0006-async-runs-worker.md) | Heavy work is asynchronous (Storage uploads, run worker) | Accepted, 2026-10-21 |
| [0007](0007-run-id-reproducibility.md) | Outputs keyed by `run_id`; reproducible runs | Accepted, 2026-10-21 |
| [0008](0008-privacy-by-design.md) | Privacy by design | Accepted, 2026-10-21 |
| [0009](0009-one-definition-per-rule.md) | One definition per business rule | Accepted, 2026-10-21 |
| [0010](0010-netlify-hosting-r2-backups.md) | Netlify frontend hosting via GitHub; Cloudflare R2 backups | Accepted, 2026-10-21 |
| [0011](0011-firecrawl-dev-research.md) | Firecrawl for development-time web research only | Accepted, 2026-10-21 |

New ADRs: next number, kebab-case filename, add a row here. Drafts by `docs-writer` go in
`docs/adr/drafts/` and are accepted by `architect`.
