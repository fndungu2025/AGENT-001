# ADR-0005: Read/write split — PostgREST reads, FastAPI for Python and state changes

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §2 "Split of responsibilities"; `.claude/CLAUDE.md` §2 decision 5

## Context
Most screens show precomputed, tenant-scoped results (KPIs, segment summaries, customer
lists). Routing every read through Python adds latency and code for no benefit.

## Decision
- The SPA reads tenant-scoped **views and RPCs directly through PostgREST** under RLS.
- Anything that runs Python or changes state (ingestion, starting runs, scoring,
  what-if, explanations, exports) goes through **FastAPI**.
- The browser never receives raw transactions.

## Alternatives considered
- **All traffic through FastAPI:** one access path, but an extra Python hop for every read.
- **All traffic through PostgREST:** cannot run the ML pipeline.

## Consequences
- RLS policies and the `v_*` / `rpc_*` surface are part of the public contract and need
  pgTAP coverage.
- Two client paths in the SPA (Supabase client + generated OpenAPI client).
