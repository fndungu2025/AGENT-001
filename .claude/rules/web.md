---
paths:
  - "apps/web/**"
---
# React SPA rules (full spec: research/PRD.md §3, §6)

## Data and state
- Data access:
  - Dashboard reads go through `supabase-js` against `v_*` views and `rpc_*` functions.
  - Python-backed actions use the generated `openapi-fetch` client in `src/lib/api`.
  - Never hand-write API types.
- State:
  - TanStack Query for server state; never copy it into Zustand.
  - URL search params for filters.
  - Zustand only for small UI state.

## Charts
- ECharts, lazy-loaded per route.
- Enable the `aria` option, include a "View as table" toggle, and use the colour-blind-safe palette. Respect `prefers-reduced-motion`.
- Downsample scatter plots to ≤ 5,000 points.

## UI and copy
- Build with shadcn/ui + Radix primitives.
- Touch targets ≥ 44px, a visible focus ring, and layouts that work at 360px wide (tables scroll inside their own container).
- Copy is plain language first, e.g. "Chance of buying again (60 days)". Always show the run and cutoff date being displayed. Risk bands use both a label and a colour.
- Never put service-role keys or secrets in `VITE_*` variables. They are public.

## Performance and tests
- Performance budgets: initial JS ≤ 250 KB gzipped, LCP ≤ 2.5s p75, INP ≤ 200ms.
- Testing: Vitest + Testing Library for components. Playwright + axe-core for flows on desktop, iPhone 13 and Pixel 7 profiles.
