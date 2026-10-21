# Work ledger

Shared state between agents (format: research/agents.md §3.5). The orchestrator writes
entries; customeriq-meta reads and summarizes them. References only — no pasted output,
no secrets, no customer data.

## TASK-0001 · Sprint Zero · P0 · status: in_progress
plan: docs/agents/plans/TASK-0001.md (roadmap M0, research/roadmap.md §2 and §3.1)
- [ ] devops-engineer  running  "monorepo scaffold (pnpm + uv) + .github/workflows/ci.yml"  (M0 deliverables 1, 2)
- [ ] db-engineer + identity-access  running  "Supabase schema v1 + RLS + pgTAP; auth scaffolding (JWT/JWKS dependency, SPA client)"  (M0 deliverables 3, 4)
- [ ] customeriq-meta + architect  running  "agent infra: .claude/agents ×20, scripts/agent-guards (tested), .claude/settings.json, ledger, ADRs 0001–0011"  (M0 deliverable 5)
- [ ] research-analyst  waiting on user approval to download  "UCI Online Retail II data profile + 60-day base rate"  (M0 deliverable 6)
escalations:
- UCI dataset download needs user approval (research/roadmap.md §3.2 item 1) — blocking deliverable 6 only
- Default session agent `"agent": "customeriq-meta"` left unset for the user to decide (research/roadmap.md §3.2 item 5) — non-blocking
decisions: ADR-0001 … ADR-0011 (docs/adr/README.md)
