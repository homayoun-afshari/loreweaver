# ADR-0001: Use a stand-alone legacy service rather than keeping state in the app database

This record covers two linked decisions: where character state lives, and what data that service holds and how it gets in.

## 1. Where character state lives

### Context

Loreweaver answers questions that depend on live character state: location, inventory and mana (see [PRD](../PRD.md)). In the product's story, an author's existing story CMS owns this data. It is a separate, older system that the author already uses, and it is the source of truth.

The agent must read that state reliably instead of guessing it, because an LLM that invents an inventory item produces exactly the continuity error the product exists to prevent. We have to decide where the character state lives and how the web app reaches it.

Constraints:

- The data is owned by another system, so the web app can't assume it controls the schema or the uptime.
- Real legacy systems have awkward field names and numeric codes, require API keys, are rate limited, and fail or slow down at times. The product must handle that gracefully.
- This is a portfolio product: it should show integration with an external system, not just a database table.

### Options considered

1. **Keep character state in the app's own database (Postgres).**
   - Pros: simplest, fast, transactional with the rest of the app, no network hop, no flaky dependency.
   - Cons: duplicates data the CMS already owns, so two copies drift apart. It removes the integration problem instead of solving it, so the product would not represent the real use case. No resilience patterns are needed, so none get built or demonstrated.

2. **A route inside the Next.js app that fakes the legacy API (`/api/legacy/character-state`).**
   - Pros: very quick, no extra deployment.
   - Cons: shares a process, a deploy and a failure domain with the web app, so it can't show real network failures, timeouts or separate ownership. Fine as a development fallback, not as the architecture.

3. **A stand-alone legacy service (separate container, own data store, REST API, API-key auth, rate limit, simulated flakiness), reached through a typed client in the web app.**
   - Pros: matches how real legacy integrations look. Failures, latency and bad data are real, so retries, timeouts, circuit breaking and validation have a purpose. Separate deployment and ownership. The agent's tools talk to a contract (OpenAPI), not to internals.
   - Cons: more to build and run (a container, a cloud deployment, secrets). Adds latency and a failure mode to every state lookup.

### Decision

Build option 3: `services/legacy-cms` is a separate Dockerized service with its own SQLite store, exposed over a documented REST API (`openapi.yaml`) and protected by an API key. The web app never reads its data directly. It calls it through a typed legacy client in `apps/web`, which acts as an anti-corruption layer: it validates responses with Zod, maps legacy fields to a clean `CharacterState` model, and applies a timeout, retries with backoff and jitter, and a circuit breaker.

Option 2 stays as a quick development fallback only.

### Consequences

**Positive**

- The agent gets clean, typed facts, or an explicit "state unavailable or possibly stale" signal. It never has to guess state.
- Legacy oddities stay at the boundary, so the rest of the app is unaffected if the CMS changes.
- The resilience work is measurable (latency, error rate, success rate after retries) and gives real numbers for the README and METRICS.
- The service deploys independently to Cloud Run, as in a real organization.

**Negative / costs**

- Extra infrastructure and a second deployment to maintain.
- Every state lookup pays a network round trip and can fail, so the product must handle "unavailable" in its answers and UI.
- Contract changes need coordination between the service and the client (mitigated by the OpenAPI contract and tests).

### Follow-ups

- Cache slow reads if the measured latency requires it (revisit once real production latency data exists).
- Enforce tenant isolation (`world_id`) at the client and in code, not in prompts (see PRD risks).

## 2. The character data: who writes it, what it looks like, and how it gets in

### Context

Section 1 says where character state lives, not who writes the data, what it looks like or how it gets into the service. The product-level assumptions are in the [PRD](../PRD.md#assumptions-v1).

**Who writes it.** In the product's story, the author's existing CMS owns the data and its owner changes it as the story moves on. In this project there is no such system, so the service ships with a **fixed snapshot**: five characters in two worlds (`world_aethel` and `world_nox`), written by hand to describe the worlds at one moment. The second world exists so that the separation of worlds can be tested.

**What it looks like.** One table, `characters`, with deliberately legacy columns and formats:

| Column               | Example                            | Legacy trait                                                   |
| -------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `char_id`            | `1`                                |                                                                |
| `char_name`          | `Aria Voss`                        |                                                                |
| `world_id`           | `world_aethel`                     | Same id as the world's lore folder (`data/lore/world_aethel/`) |
| `loc_code`           | `17`                               | A numeric code instead of a place name (17 is the Ice Citadel) |
| `mana_pts`, `hp_pts` | `020`, `085`                       | Numbers stored as zero-padded text                             |
| `cond_flag`          | `OK`                               | A short code (`WND` is wounded)                                |
| `inv_str`            | `flint,broken sword,health potion` | A list stored as one comma-separated string                    |
| `last_upd`           | `09-OCT-26 14:32`                  | An old date format, without a time zone                        |

The API reshapes these rows a little (a nested `status` object, for example) and the typed client maps them to the clean `CharacterState` model, so none of these formats reach the agent.

### Options considered

1. **A PHP array next to the schema.** Pros: one copy of the data, in the same file as the table it fills; the container needs nothing else to start; easy to read in a review. Cons: changing a character means a code change and a new image.
2. **A seed file (SQL, JSON or CSV) loaded at start.** Pros: data separate from code. Cons: one more file to ship into the image and one more format to parse, for five rows.
3. **A write API, filled by a script.** Pros: closest to a real system. Cons: a write path that v1 does not need, and one more thing to secure.

### Decision

Option 1. The rows are written as a PHP array in `services/legacy-cms/src/Database.php` (`migrateAndSeed`). `bin/init-db.php` runs it before the server starts, and it inserts the rows only into an empty table. In Docker the database file lives inside the container, so every new container starts from the same snapshot.

### Consequences

- The service is **read-only**: its API has only `GET` endpoints. Loreweaver never writes character state, and nothing else does either while it runs.
- Changing the state of a character means editing the array and starting a new container (or deleting the local SQLite file). This is acceptable because v1 treats the data as a snapshot.
- Knowledge about the CMS is kept by hand in two places of the web app: the meaning of the location codes (`apps/web/src/lib/legacy/locations.ts`) and the list of each world's character names and ids (`apps/web/src/lib/worlds.ts`, see ADR-0003). A change to the seed has to be mirrored there.

### Follow-ups

- A write path (an API, or a sync from the author's own tools), if character state ever has to change while the product runs.
- If reads get cached, invalidate the cache when the CMS reports a change (webhooks or change data capture). Character state is never embedded, so its changes never require re-indexing the lore.
- Read the character list and the location names from the CMS, instead of keeping copies in the web app.
