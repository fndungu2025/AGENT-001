# ADR-0003: Supabase (Postgres) as the data platform, not Firebase or MongoDB

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §3 "Primary: Supabase"; `.claude/CLAUDE.md` §2 decision 3

## Context
The data is relational (transactions → customers → segments, with joins and aggregates).
The project builds on SQL skills and needs Power BI connectivity for the academic deliverable.

## Decision
Use **Supabase**: Postgres 15+, Auth, Storage, Realtime, pg_cron and Queues on one bill.
Schema changes are SQL migrations in `supabase/migrations/` (never dashboard edits).

## Alternatives considered
- **Firebase (Firestore):** document store with weak joins/aggregation; per-read billing
  is a poor fit for read-heavy dashboards; poor BI connectivity.
- **MongoDB Atlas:** workable, but gives up SQL skills and native BI connectivity; auth separate.

## Consequences
- Native Postgres connector for Power BI (F-19) and an official MCP server for development.
- Free tier pauses after 7 days idle and has no backups: nightly `pg_dump` to R2
  (ADR-0010); move to Pro ($25/mo) before any external user.
- Vendor features (RLS, Auth hooks) shape tenancy (ADR-0004).
