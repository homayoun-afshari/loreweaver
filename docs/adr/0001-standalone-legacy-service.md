# ADR-0001: Use a stand-alone legacy service rather than keeping state in the app database

**Status:** Accepted · **Date:** 2026-10-09 · **Owner:** Homayoun Afshari

## Context

Loreweaver answers questions that depend on live character state: location, inventory and mana (see [PRD](../PRD.md)). In the product's story, an author's existing story CMS owns this data. It is a separate, older system that the author already uses, and it is the source of truth.

The agent must read that state reliably instead of guessing it, because an LLM that invents an inventory item produces exactly the continuity error the product exists to prevent. We have to decide where the character state lives and how the web app reaches it.

Constraints:

- The data is owned by another system, so the web app can't assume it controls the schema or the uptime.
- Real legacy systems have awkward field names and numeric codes, require API keys, are rate limited, and fail or slow down at times. The product must handle that gracefully.
- This is a portfolio product: it should show integration with an external system, not just a database table.

## Options considered

1. **Keep character state in the app's own database (Postgres).**
   - Pros: simplest, fast, transactional with the rest of the app, no network hop, no flaky dependency.
   - Cons: duplicates data the CMS already owns, so two copies drift apart. It removes the integration problem instead of solving it, so the product would not represent the real use case. No resilience patterns are needed, so none get built or demonstrated.

2. **A route inside the Next.js app that fakes the legacy API (`/api/legacy/character-state`).**
   - Pros: very quick, no extra deployment.
   - Cons: shares a process, a deploy and a failure domain with the web app, so it can't show real network failures, timeouts or separate ownership. Fine as a development fallback, not as the architecture.

3. **A stand-alone legacy service (separate container, own data store, REST API, API-key auth, rate limit, simulated flakiness), reached through a typed client in the web app.**
   - Pros: matches how real legacy integrations look. Failures, latency and bad data are real, so retries, timeouts, circuit breaking and validation have a purpose. Separate deployment and ownership. The agent's tools talk to a contract (OpenAPI), not to internals.
   - Cons: more to build and run (a container, a cloud deployment, secrets). Adds latency and a failure mode to every state lookup.

## Decision

Build option 3: `services/legacy-cms` is a separate Dockerized service with its own SQLite store, exposed over a documented REST API (`openapi.yaml`) and protected by an API key. The web app never reads its data directly. It calls it through a typed legacy client in `apps/web`, which acts as an anti-corruption layer: it validates responses with Zod, maps legacy fields to a clean `CharacterState` model, and applies a timeout, retries with backoff and jitter, and a circuit breaker.

Option 2 stays as a quick development fallback only.

## Consequences

**Positive**

- The agent gets clean, typed facts, or an explicit "state unavailable or possibly stale" signal. It never has to guess state.
- Legacy oddities stay at the boundary, so the rest of the app is unaffected if the CMS changes.
- The resilience work is measurable (latency, error rate, success rate after retries) and gives real numbers for the README and METRICS.
- The service deploys independently to Cloud Run, as in a real organisation.

**Negative / costs**

- Extra infrastructure and a second deployment to maintain.
- Every state lookup pays a network round trip and can fail, so the product must handle "unavailable" in its answers and UI.
- Contract changes need coordination between the service and the client (mitigated by the OpenAPI contract and tests).

**Follow-ups**

- Cache slow reads if the measured latency requires it (revisit once real production latency data exists).
- Enforce tenant isolation (`world_id`) at the client and in code, not in prompts (see PRD risks).
