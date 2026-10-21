# ADR-0010: Frontend hosting on Netlify via GitHub integration; Cloudflare R2 for backups

- **Status:** Accepted, 2026-10-21 (user decision)
- **Sources:** `research/tech-stack.md` decision update (2026-10-21) and §4 "Deployment
  platforms", "Backup and migration strategy"; `.claude/CLAUDE.md` §2 Stack

## Context
The static SPA needs push-to-deploy hosting with per-PR previews. Supabase Free has no
downloadable backups.

## Decision
- Host the SPA on **Netlify**, deployed by Netlify's Git integration: every push to
  `main` deploys production; every PR gets a Deploy Preview. Until `apps/web` exists,
  `netlify.toml` builds the research-docs viewer (`scripts/build-site.sh` → `site/`).
- API + worker stay on **Render**; Netlify Functions cannot run Python, so no backend moves.
- Off-site backups: nightly `pg_dump` from GitHub Actions to **Cloudflare R2**.

## Alternatives considered
- **Cloudflare Pages** ($0): the original choice; remains the fallback.

## Consequences
- Netlify Free is a hard cap of 300 credits/month (a production deploy costs 15) and
  pauses all projects when exceeded; plan on Personal ($9/mo) with real traffic.
- FastAPI CORS must allow `deploy-preview-*--<site>.netlify.app` and the production domain.
- The one-time Netlify import is done by the user in the Netlify UI.
