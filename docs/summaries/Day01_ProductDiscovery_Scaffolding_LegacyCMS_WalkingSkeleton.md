# Day 1: Product Discovery, Scaffolding, Legacy CMS, and Walking Skeleton

The full account is in the [Day 1 report](../reports/day-1.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **Product Discovery:** the problem, the personas, the scope and non-goals, and the success metrics with their guardrail targets.
- **Scaffolding:** a pnpm monorepo with a strict TypeScript Next.js app, a typed environment loader, pinned versions and CI on every pull request.
- **Legacy CMS:** a PHP service that owns character state, with an API key, a rate limit and simulated failures, and a typed client with a timeout, retries and a circuit breaker.
- **Walking Skeleton:** a first page and a health route on Vercel, the CMS on Google Cloud Run, and a preview deployment for every pull request.

## Documents Involved

- **ADR:** [ADR-0001](../adr/0001-standalone-legacy-service.md), character state in a stand-alone legacy service, and how its data gets in.
- **PRD:** [the product requirements](../PRD.md): problem, personas, scope, non-goals, success metrics and risks.
- **Architecture Diagram:** [the deployed skeleton](Day01_ProductDiscovery_Scaffolding_LegacyCMS_WalkingSkeleton.svg), with the web app and the legacy CMS.
- **Report:** [discovery, scaffolding and the legacy layer](../reports/day-1.md).
- **Metrics:** [created](../METRICS.md) to hold every measured figure, each with its setup, results, findings, caveats and how to reproduce it.

## Decisions Made

- **Stand-alone Legacy Service:** character state is owned by a separate service with its own SQLite store and REST API, not by the app database.
- **Anti-Corruption Layer:** the app reaches the CMS only through a client that validates, maps and retries, and reports stale data instead of guessing.
- **Seed Snapshot:** the character data is a fixed seed, so every new container starts from the same state.
- **Hosting:** the web app on Vercel and the CMS on Cloud Run in `europe-west1`, with its API key in Secret Manager.

## Metrics Measured

- **Legacy CMS:** the error rate and latency of the service on its own, under its simulated delays and failures.
- **Legacy Client:** the success rate after retries, the attempts per call and the latency through the anti-corruption layer.
