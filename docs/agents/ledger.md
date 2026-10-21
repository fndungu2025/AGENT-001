# Work ledger

Shared state between agents (format: research/agents.md §3.5). The orchestrator writes
entries; customeriq-meta reads and summarizes them. References only — no pasted output,
no secrets, no customer data.

## TASK-0001 · Sprint Zero · P0 · status: done (except data profile)
plan: docs/agents/plans/TASK-0001.md (roadmap M0, research/roadmap.md §2 and §3.1)
- [x] devops-engineer  done  "monorepo scaffold (pnpm + uv) + .github/workflows/ci.yml"  (M0 deliverables 1, 2)
- [x] db-engineer + identity-access  done  "schema v1 + RLS + SQL tests (74); auth deps + 28 tests; applied to Supabase dev"  (M0 deliverables 3, 4)
- [x] customeriq-meta + architect  done  "agent infra: 20 agents, guards 94/94, settings, ledger, ADR-0001–0011"  (M0 deliverable 5)
- [ ] research-analyst  blocked  "UCI data profile: network policy denies archive.ics.uci.edu; script ready"  (M0 deliverable 6)
escalations:
- UCI host blocked by environment network policy: user to allow the host or upload the zip (non-blocking for M1 schema work)
decisions: ADR-0001 … ADR-0011 (docs/adr/README.md); default session agent left unset (user decision 2026-10-21); RLS choices in migration v1 accepted by architect (demo org exempt from the owner rule; app.demo_org_id() security definer; demo org_settings readable; end-user writes via API only)
