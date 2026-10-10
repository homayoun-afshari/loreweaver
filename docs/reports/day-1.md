# Day 1 report: Discovery, scaffolding and the legacy layer

**Status:** Build and Measure complete. Build is deployed; the measured numbers are in [`docs/METRICS.md`](../METRICS.md).

## 1. Summary

Day 1 turned an empty folder into a production-shaped, deployed skeleton:

- A **product definition** (PRD) and the first **architecture decision** (ADR-0001).
- A **monorepo** with a Next.js web app, tooling, and **CI** on every pull request.
- A **legacy CMS** service that owns character state, and a **typed client** in the web app that talks to it safely.
- Both pieces **live in the cloud**: the web app on Vercel, the CMS on Google Cloud Run.

Nothing here uses AI yet. The point of Day 1 is that the AI will later read **trusted, structured facts** instead of guessing.

## 2. Learn, Prepare and Build

| Section                   | What was done                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                 | Product discovery (personas, jobs to be done, scope and non-goals), metric design (North Star, guardrails, p95), walking skeleton, deterministic vs probabilistic systems, legacy integration patterns (anti-corruption layer, timeouts, retries, circuit breaker, idempotency), cloud basics (regions, containers vs serverless, environments, IAM). |
| **Prepare**               | Git and GitHub (with `gh` and 2FA), Node 24 and pnpm 12 through Corepack, PHP 8.4 and Composer, Docker Desktop, a Vercel account, a Google Cloud project with a budget alert, the Cloud Run, Artifact Registry, Cloud Build and Secret Manager APIs, region `europe-west1`, and Claude Code.                                                          |
| **Build A: Product**      | `docs/PRD.md` (problem, personas, scope, metrics, risks). ADR-0001: keep character state in a stand-alone legacy service, not the app database.                                                                                                                                                                                                       |
| **Build B: Scaffolding**  | pnpm monorepo; Next.js app (TypeScript strict, ESLint, Prettier, Tailwind); Zod; Vitest; typed env loader that fails at startup; pinned Node and package versions; GitHub Actions CI.                                                                                                                                                                 |
| **Build C: Legacy layer** | `services/legacy-cms` (PHP/Slim, SQLite, Docker) with API key, rate limit and simulated failures; an OpenAPI contract; a typed client with timeout, retries, circuit breaker; unit tests.                                                                                                                                                             |
| **Build D: Cloud**        | "Hello, author" page and `/api/health` on Vercel; the CMS container on Cloud Run; the API key in Secret Manager and Vercel; preview deployments per pull request.                                                                                                                                                                                     |

## 3. By area

| Area            | Most important things added or used                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | Next.js App Router page "Hello, author" (`apps/web/src/app/page.tsx`), the root layout, Tailwind. Nothing else yet.                                                                                                                                                                                                                                           |
| **Backend**     | In `apps/web`: `/api/health`, `/api/legacy/character-state` (quick fallback), the env loader, and the **legacy client** (`src/lib/legacy/`): Zod mapping, timeout, retries with backoff and jitter, circuit breaker, typed results. Separate service: the **legacy CMS** (PHP/Slim, SQLite, API key, rate limit, simulated failures), described in section 7. |
| **Tooling**     | pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest, msw (HTTP mocking), `tsx`, Docker and Compose, GitHub Actions, the `gcloud` and `gh` CLIs.                                                                                                                                                                                                      |
| **Documenting** | `docs/PRD.md`, ADR-0001, the OpenAPI contract (`services/legacy-cms/openapi.yaml`), `docs/METRICS.md`, the README, and this report.                                                                                                                                                                                                                           |

## 4. By environment

| Environment | Web app                         | Legacy CMS                                              | Secrets                                                 |
| ----------- | ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| **Dev**     | `pnpm dev` on localhost:3000    | `docker compose up` on localhost:8080                   | `apps/web/.env.local` (not in Git)                      |
| **Preview** | One Vercel URL per pull request | The same Cloud Run service as prod (read-only, so safe) | Vercel environment variables (Preview)                  |
| **Prod**    | Vercel, from the `main` branch  | Cloud Run, `europe-west1`                               | Vercel variables (Production) and Google Secret Manager |

CI is not an environment: it is the check that runs on every pull request and every push to `main`, before Preview and Prod.

## 5. Routing

Next.js App Router: the **folder path is the URL**. `page.tsx` makes a screen for browsers, `route.ts` makes an endpoint for code.

| URL                               | File (`apps/web/src/app/`)            | Kind     | Purpose                                |
| --------------------------------- | ------------------------------------- | -------- | -------------------------------------- |
| `/`                               | `page.tsx`                            | Page     | "Hello, author"                        |
| `GET /api/health`                 | `api/health/route.ts`                 | Endpoint | Liveness, environment and git commit   |
| `GET /api/legacy/character-state` | `api/legacy/character-state/route.ts` | Endpoint | Quick development fallback for the CMS |

Both kinds run on the same Node server (serverless functions on Vercel). The **legacy CMS** is a separate PHP server with its own routes, written as an explicit list in code and not as folders: `GET /health`, `GET /v1/characters/{id}/state` and `GET /v1/characters` (section 7).

## 6. Unit tests and CI

**Unit tests** (Vitest, 42 tests, no network or Docker needed; HTTP is faked with msw):

| Area                | What is checked                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Mapping             | Every legacy field converts correctly; empty inventory; unknown location; contract violations are rejected.                    |
| Retry logic         | A `503` then success works; backoff values double with jitter and are capped; gives up after 3 retries with a typed error.     |
| What is not retried | `404` and `401` return after one call; bad JSON or a wrong shape gives `invalid_response`.                                     |
| Timeout             | A slow response is cut off and reported as `unavailable / timeout`.                                                            |
| Circuit breaker     | Opens after repeated failures and then fails fast without calling the CMS; half-open trial; `404` does not count as a failure. |
| Startup and routes  | The env loader names every missing variable; the quick route and `/api/health` return the right status codes.                  |

**CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`, on a clean machine, with the same pinned Node and pnpm as locally:

1. `pnpm install --frozen-lockfile` (fails if the lockfile and `package.json` disagree)
2. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`

A pull request can only be merged when this is green.

## 7. The legacy CMS

**What it provides:** the character state the AI must never guess: where a character is, what they carry, their mana and health. It imitates an old system on purpose: snake_case fields, numbers stored as text, odd dates, an API key, a rate limit and random failures.

**Rules for every `/v1` request**

| Rule       | Behaviour                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Auth       | Header `X-API-Key` must match, otherwise `401`.                                                 |
| Rate limit | 30 requests per minute per key, otherwise `429` with `Retry-After` (seconds).                   |
| Flakiness  | Random 200 to 1500 ms delay on every call; about 5% of calls fail with `503` and `Retry-After`. |
| Errors     | Always JSON: `{"error": {"code": "...", "message": "..."}}`.                                    |

### What is stored

The CMS keeps its data in one **SQLite** file (`/app/data/legacy.sqlite` inside the container, path set by `LEGACY_DB_PATH`) with two tables:

**`characters`** (the system of record), with a legacy-style layout:

| Column      | SQLite type          | Stored as                                |
| ----------- | -------------------- | ---------------------------------------- |
| `char_id`   | INTEGER, primary key | Character id                             |
| `char_name` | TEXT                 | Name                                     |
| `world_id`  | TEXT (indexed)       | The world it belongs to                  |
| `loc_code`  | INTEGER              | Numeric location code                    |
| `mana_pts`  | TEXT                 | Zero-padded number as text, e.g. `"020"` |
| `hp_pts`    | TEXT                 | Zero-padded number as text               |
| `cond_flag` | TEXT                 | `OK` or `WND`                            |
| `inv_str`   | TEXT                 | Inventory as one comma-separated string  |
| `last_upd`  | TEXT                 | `DD-MON-YY HH:MM`, no time zone          |

**`rate_limit`** (supports the 30 requests per minute rule): `key_id` (the API key), `window` (the minute) and `hits` (calls in that minute), with `(key_id, window)` as the primary key.

**Seed data** (inserted only when the `characters` table is empty):

| id  | Name         | World          | Location (code)   | Mana | HP  | Condition | Inventory                          |
| --- | ------------ | -------------- | ----------------- | ---- | --- | --------- | ---------------------------------- |
| 1   | Aria Voss    | `world_aethel` | Ice Citadel (17)  | 020  | 085 | OK        | flint, broken sword, health potion |
| 2   | Brannoc Hale | `world_aethel` | Ember Keep (4)    | 000  | 100 | OK        | war hammer, iron ration            |
| 3   | Sera Quill   | `world_aethel` | Glass Library (9) | 075  | 060 | WND       | spellbook, silver key, ink vial    |
| 4   | Kael Draven  | `world_nox`    | Hollow Mine (22)  | 040  | 090 | OK        | lantern, cracked mask              |
| 5   | Mira Sol     | `world_nox`    | Salt Harbour (3)  | 100  | 045 | WND       | star chart                         |

The location names are not stored: the CMS only has the numeric code, and the web app's client maps it to a name. The file lives inside the container, so every new container starts from the seed data.

### Endpoints

| Method and path                                | Purpose                            | Auth | Success | Errors                  |
| ---------------------------------------------- | ---------------------------------- | ---- | ------- | ----------------------- |
| `GET /health`                                  | Is the service alive?              | No   | `200`   | none                    |
| `GET /v1/characters/{id}/state`                | One character's full state         | Yes  | `200`   | 400, 401, 404, 429, 503 |
| `GET /v1/characters?world_id=&page=&per_page=` | Characters of one world, paginated | Yes  | `200`   | 400, 401, 429, 503      |

**Parameters**

| Endpoint | Parameter   | Type    | Rules                                                  |
| -------- | ----------- | ------- | ------------------------------------------------------ |
| state    | `id` (path) | integer | Required; non-numeric gives `400`, unknown gives `404` |
| list     | `world_id`  | string  | Required (missing gives `400`)                         |
| list     | `page`      | integer | Default 1, minimum 1                                   |
| list     | `per_page`  | integer | Default 20, from 1 to 50                               |

### Schemas

**`GET /health`** returns `{ "status": "ok" }`.

**`GET /v1/characters/{id}/state`** returns a `CharacterState` (legacy shape):

| Field              | Type    | Meaning and legacy quirk                                                                                 |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `char_id`          | integer | Character id                                                                                             |
| `char_name`        | string  | Name                                                                                                     |
| `world_id`         | string  | The world the character belongs to (`world_aethel`, `world_nox`)                                         |
| `loc_code`         | integer | **Numeric** location code: 3 Salt Harbour, 4 Ember Keep, 9 Glass Library, 17 Ice Citadel, 22 Hollow Mine |
| `inv_str`          | string  | Inventory as **one comma-separated string**                                                              |
| `status.mana_pts`  | string  | **Zero-padded number as text**, e.g. `"020"`                                                             |
| `status.hp_pts`    | string  | Zero-padded number as text, e.g. `"085"`                                                                 |
| `status.cond_flag` | string  | `"OK"` (healthy) or `"WND"` (wounded)                                                                    |
| `last_upd`         | string  | **Odd date** `DD-MON-YY HH:MM`, no time zone, e.g. `"09-OCT-26 14:32"`                                   |

```json
{
  "char_id": 1,
  "char_name": "Aria Voss",
  "world_id": "world_aethel",
  "loc_code": 17,
  "inv_str": "flint,broken sword,health potion",
  "status": { "mana_pts": "020", "hp_pts": "085", "cond_flag": "OK" },
  "last_upd": "09-OCT-26 14:32"
}
```

**`GET /v1/characters?world_id=...`** returns a `CharacterPage`:

| Field         | Type    | Meaning                                     |
| ------------- | ------- | ------------------------------------------- |
| `page`        | integer | Current page                                |
| `per_page`    | integer | Page size used                              |
| `total`       | integer | Characters in that world                    |
| `total_pages` | integer | Number of pages                             |
| `data`        | array   | Items of `{ char_id, char_name, world_id }` |

The full contract is `services/legacy-cms/openapi.yaml`.

## 8. The anti-corruption layer

The typed client in `apps/web/src/lib/legacy/` is the only code that talks to the CMS. It translates the legacy model into the app's own, so legacy oddities never spread:

| Legacy                          | Clean model (`CharacterState`)                     |
| ------------------------------- | -------------------------------------------------- |
| `mana_pts: "020"`               | `mana: 20` (number)                                |
| `inv_str: "flint,broken sword"` | `inventory: ["flint", "broken sword"]`             |
| `loc_code: 17`                  | `location: { code: 17, name: "Ice Citadel" }`      |
| `cond_flag: "WND"`              | `condition: "wounded"`                             |
| `last_upd: "09-OCT-26 14:32"`   | `updatedAt: "2026-10-09T14:32:00.000Z"` (ISO, UTC) |

It also protects the app from the CMS's bad behaviour:

- **Validates** every response with Zod. A response that breaks the contract becomes an `invalid_response` error, never silently wrong data. An unknown location code stays `name: null`; it is never guessed.
- **Timeout** of 2 s per attempt.
- **Retries** failures worth retrying (5xx, 429, network, timeout) up to 3 times, with exponential backoff and jitter. 404 and 401 are not retried.
- **Circuit breaker:** after 5 failed calls in a row it stops calling the CMS for 30 s, then tries once.
- **Typed errors, never exceptions:** every call returns `{ ok: true, value }` or `{ ok: false, error }`, with `error.kind` of `not_found`, `unauthorized`, `invalid_response` or `unavailable` (always with `stale: true` and the message "Character service unavailable; state may be stale."). The agent can read this and say so instead of inventing state.

## 9. Roles of Vercel and Google Cloud

| Service                               | Role                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel**                            | Hosts the **web app** (Next.js). Builds from GitHub, publishes **Production** from `main` and a **Preview** URL for each pull request. Holds the web app's environment variables. |
| **Google Cloud Run**                  | Runs the **legacy CMS container**, scaling to zero when idle (max 1 instance).                                                                                                    |
| **Google Secret Manager**             | Stores the CMS API key; Cloud Run injects it into the container as `LEGACY_API_KEY`.                                                                                              |
| **Cloud Build and Artifact Registry** | Build the Docker image in the cloud and store it for Cloud Run.                                                                                                                   |
| **GitHub**                            | Stores the code, runs CI, and triggers Vercel.                                                                                                                                    |

Live: web app `https://loreweaver-nine.vercel.app` (`/api/health` reports `environment: production`); CMS `https://legacy-cms-vq2vvx5lxq-ew.a.run.app` (`/health` returns ok).

## 10. Measure (headline results)

Measured on a local CMS with the rate limit raised, 500 requests, 4 at a time (details and the 100-request run in `docs/METRICS.md`):

| Metric                             | Result            |
| ---------------------------------- | ----------------- |
| CMS error rate (raw)               | 4.6%              |
| CMS latency p50 / p95              | 873 ms / 1473 ms  |
| Client success rate after retries  | 100% (500 of 500) |
| Extra HTTP calls caused by retries | 4%                |

## 11. Additional items

- `apps/web/AGENTS.md`: generated by Next.js, tells AI coding agents to read the docs for the installed Next version.
- `pnpm format:check` and `eslint-config-prettier`, added to CI so formatting is enforced.
- `docker-compose.yml` to run the CMS locally with one command.
- `services/legacy-cms/.gcloudignore`, `apps/web/vercel.json` (Paris function region, near the CMS) and `engines` in `apps/web/package.json` (Node 24 on Vercel).
- `/api/health` also reports the environment and git commit, to show which deployment is live.
- `"endOfLine": "auto"` in `.prettierrc.json`, because Git on Windows converts line endings.
- `pnpm measure:legacy` (script `apps/web/scripts/measure-legacy.ts`, run with `tsx`) and `src/lib/stats.ts` for percentiles, with tests; `LEGACY_RATE_LIMIT_PER_MIN` can be overridden in `docker-compose.yml` for load tests.
- Generated files `tsconfig.tsbuildinfo` and `next-env.d.ts` were removed from Git and ignored.

## 12. Known limits

- The CMS uses PHP's built-in server (4 workers): fine for a mock, not for real production.
- The CMS database is re-seeded each time a container starts, and previews share the production CMS.
- The CMS is public and protected only by its API key.
- The web app does not call the CMS yet. The agent tool that uses the client comes on Day 4.
