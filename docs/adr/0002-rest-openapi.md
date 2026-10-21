# ADR-0002: REST + OpenAPI, not tRPC or GraphQL

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/tech-stack.md` §2 "API architecture"; `.claude/CLAUDE.md` §2 decision 2

## Context
The SPA is TypeScript; the backend is Python (ADR-0001). We want end-to-end type safety
without a second backend language.

## Decision
FastAPI exposes a versioned **REST** API (`/v1`, snake_case JSON, RFC 9457 problem+json
errors). Types flow FastAPI → `openapi.json` → `openapi-typescript` / `openapi-fetch`
generated client (`pnpm gen:api`); CI fails if the generated client differs.

## Alternatives considered
- **tRPC:** requires a TypeScript backend, so it is ruled out.
- **GraphQL:** access patterns are fixed dashboard queries, not open-ended graph
  traversal; it would add complexity for no gain.

## Consequences
- The OpenAPI document is a contract; breaking changes need a new version or approval.
- Simple tenant-scoped reads may bypass the API and go to PostgREST (ADR-0005).
