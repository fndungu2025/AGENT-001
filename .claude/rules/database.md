---
paths:
  - "supabase/**"
  - "apps/api/app/services/**"
  - "apps/api/app/repositories/**"
---
# Database rules (full schema: research/PRD.md §4)

## Migrations
- Every change is a new file from `supabase migration new <name>`. Never edit applied migrations or use dashboard edits.
- Migrations are forward-only. Destructive changes go expand → backfill → contract across releases, and need the user's approval.
- After schema changes:
  - regenerate types (`supabase gen types typescript`);
  - run `supabase test db`;
  - check the Supabase security and performance advisors (via MCP).

## Tables and tenancy
- Every tenant table has:
  - `org_id uuid not null references organizations(id) on delete cascade`;
  - `created_at` (and `updated_at` where the row changes);
  - RLS enabled, with policies that use `app.current_org_id()` and `app.has_role(...)`.
- Analytics output tables (`customer_*`, `kmeans_clusters`, `model_evaluations`, `dim_*`, `fact_*`) have **no** end-user write policies; only the worker writes them.
- Materialized views have no RLS. Expose them only through `security_invoker` views or RPCs that filter by `app.current_org_id()`.
- Each new table needs a pgTAP test proving org A cannot read or write org B's rows, and that a viewer cannot write.
- Storage paths are always prefixed `{org_id}/`, and storage policies check the folder name.

## Types and indexes
- Use `numeric` for money, `timestamptz` for times (UTC), and `text` with CHECK constraints rather than varchar(n).
- Keys are uuid PKs, except bigint identity on `fact_order_line`.
- Put `org_id` (or `run_id`) first in composite indexes. Use `CREATE INDEX CONCURRENTLY` on large existing tables.

## Code that touches the database
- Service-role code must go through a repository function that takes `org_id` explicitly.
- Bulk loads use `COPY` over `DATABASE_DIRECT_URL`.
- Request traffic goes through the pooler (`DATABASE_URL`, port 6543) with `prepare_threshold=None` and `NullPool`.
