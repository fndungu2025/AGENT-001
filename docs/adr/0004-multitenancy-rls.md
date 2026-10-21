# ADR-0004: Shared-schema multi-tenancy with `org_id` + Postgres RLS

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/PRD.md` §4 tenancy model; `research/tech-stack.md` §2 "Authentication";
  `.claude/CLAUDE.md` §2 decision 4

## Context
Multiple retailer organizations share one deployment. Zero cross-tenant leaks is a
success criterion. Expected scale is ≤ 2,000 orgs on a small budget.

## Decision
**Shared database, shared schema, `org_id` on every tenant-scoped row**, enforced by
**Row-Level Security** on every tenant table. A Supabase custom access-token hook adds
the `org_id` (and role) claim to the JWT. Roles: `owner > admin > analyst > viewer`.
The service-role key (bypasses RLS) is server-only, and every service-role query filters
by `org_id` explicitly. Other orgs' resources return 404, not 403.

## Alternatives considered
- **Schema-per-tenant / database-per-tenant:** stronger physical isolation, but more
  complex and costly at our scale. Revisit only if an enterprise tenant requires it.

## Consequences
- pgTAP cross-tenant tests are a release gate.
- Any change to RLS, auth, role or storage-policy semantics escalates to the user.
