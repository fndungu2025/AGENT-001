# ADR-0011: Firecrawl for development-time web research only

- **Status:** Accepted, 2026-10-21 (user decision)
- **Sources:** `research/tech-stack.md` decision update (2026-10-21) and §5 MCP table;
  `.claude/CLAUDE.md` §2 Stack and §6; `research/agents.md` §4.20 `web-researcher`

## Context
Agents need current library docs, competitor features and pricing, and regulations while
building. The product itself has no need for web scraping.

## Decision
Use the **Firecrawl MCP server** as a development-time research tool, mainly through the
`web-researcher` agent (outputs under `research/web/**`). It is **never** used by the
product at runtime and is **never** sent customer data.

## Alternatives considered
- **Built-in WebFetch/WebSearch only:** still available to agents (e.g. `research-analyst`);
  Firecrawl was added on top by user decision rather than replacing them.

## Consequences
- Free tier to start ($0); a paid plan only if research volume grows (needs user approval).
- `FIRECRAWL_API_KEY` is local developer tooling, never committed.
