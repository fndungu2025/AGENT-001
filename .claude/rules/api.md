---
paths:
  - "apps/api/**"
---
# FastAPI rules (full spec: research/PRD.md §5)

## Request handling
- Routers live in `app/routers/<area>.py`, business logic in `app/services/`, and Pydantic schemas in `app/schemas/`. Route handlers stay thin.
- Auth: the `get_current_user` dependency verifies the Supabase JWT via JWKS (`iss`, `aud=authenticated`, `exp`). Then `require_role("analyst")` re-checks `memberships` (cached for 60s).
- Other orgs' resources return **404**. All errors use RFC 9457 problem+json with a stable `code` (e.g. `INSUFFICIENT_DATA`, `RUN_IN_PROGRESS`).
- Money is serialized as decimal strings. Timestamps are ISO-8601 UTC.
- POST endpoints that create resources honor `Idempotency-Key`. Lists use cursor pagination: `{data, next_cursor, total_estimate}`.

## Async work and limits
- Long work (ingest, runs, exports) returns **202** and creates a job row. Never block a request on pandas or sklearn work over ~1s.
- Rate limits use `slowapi` with the per-plan limits in PRD §5.6. A 429 response includes `Retry-After`.

## Security and contract
- Never log request bodies or data values. Sentry has PII scrubbing on.
- Never load joblib/pickle files from user-supplied paths; only from `models/{org_id}/{run_id}/`.
- Keep the OpenAPI spec accurate: add a `summary`, response models and error responses to every route. CI regenerates the TS client and fails on any diff.
