# ADR-0006: Heavy work is asynchronous — Storage uploads and a run worker

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §2 "Long-running work"; `research/PRD.md` F-05 (runs) and
  §5 worker; `.claude/CLAUDE.md` §2 decision 6

## Context
Uploads can be 1M+ rows; cleaning and training take minutes and exceed HTTP time and
memory budgets.

## Decision
- Uploads go browser → **Supabase Storage via a signed URL**, never through the API.
- A run is a row in `pipeline_runs` (`queued` → …). A worker claims it with
  `SELECT … FOR UPDATE SKIP LOCKED`, updates status/stage/progress, and writes results.
- Status reaches the UI through **Supabase Realtime** (or polling `GET /v1/runs/{id}`).
- Never train models inside an HTTP request.

## Alternatives considered
- **Synchronous processing in the request:** times out and exhausts memory.
- **Redis/Celery queue:** another service; a Postgres status table (later Supabase
  Queues / pgmq) avoids it.

## Consequences
- The worker has no public endpoints and uses the service role with explicit `org_id` filters.
- Errors are recorded as `error_code`/`error_message`; the UI never sees a stack trace.
