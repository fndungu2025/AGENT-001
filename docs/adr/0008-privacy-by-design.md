# ADR-0008: Privacy by design — no direct PII, hashed refs, short upload retention

- **Status:** Accepted, 2026-10-21
- **Sources:** `research/PRD.md` §6 NFR "Data minimization (PII)"; `.claude/CLAUDE.md` §2
  decision 8 and §4 "Never do without explicit approval"

## Context
Retailers upload order history that can contain customer emails and other personal data.
The product needs behavioural signals, not identities.

## Decision
- The MVP stores **no names, emails, phone numbers or addresses**.
- If a mapped `customer_ref` looks like an email, it is replaced on ingest with
  `HMAC-SHA256(org_salt, lower(email))`.
- Original upload files are deleted after successful ingest; default retention 7 days
  (configurable 0–30) so failed runs can be re-processed.
- No customer-level data goes to Sentry, PostHog, LLMs or other third parties.

## Alternatives considered
- **Store PII for richer exports / outreach:** raises compliance burden and breach
  impact; out of MVP scope.

## Consequences
- Customer refs shown in the app and exports are the uploaded refs, or their hashes for email-like refs.
- Whether pilots accept hashed emails is an open question (PRD Appendix C).
