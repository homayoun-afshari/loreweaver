# Loreweaver

A worldbuilding copilot for novelists. It answers questions about your fictional world, and its suggestions follow the world's own rules.

Loreweaver is built over seven days. Each day ends with a report in [`docs/reports/`](docs/reports/) that describes what was added, so the history of the project can be followed day by day.

## How it fits together

- **Web app** (`apps/web`): a Next.js chat. The browser talks to API routes; the model is Claude, called through the Vercel AI SDK.
- **Legacy CMS** (`services/legacy-cms`): a stand-alone service that owns live character state (location, inventory, mana). The chat reads it through a tool and shows the result as a **Character Status Card**.
- **Lore search**: a second tool, `search_lore`, finds the passages of the author's lore that match a question and the chat shows them as **Lore Citation** cards, which the answer cites by id.
- **Lore** (`data/lore`): the worlds' lore as Markdown files. `pnpm ingest` cuts them into chunks, turns each chunk into a vector with an embedding model (Voyage AI) and stores them in Postgres, ready for similarity search.
- **Postgres** (with the pgvector extension): stores user feedback on answers and the lore chunks with their vectors.

You can run the whole thing on your machine. Only the model calls need an account.

## What you need

**Tools**

| Tool             | Version                     | Needed for                                  |
| ---------------- | --------------------------- | ------------------------------------------- |
| Git              | any recent                  | Cloning the repo                            |
| Node.js          | 24 (see `.nvmrc`)           | The web app                                 |
| pnpm             | 12.10.1, through Corepack   | Installing and running (`corepack enable`)  |
| Docker Desktop   | any recent                  | The legacy CMS and Postgres on your machine |
| PHP and Composer | PHP 8.2 or newer (optional) | Running the CMS without Docker              |

**Accounts**

| Account                                          | Needed for                                                                                                        | Required?                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [Anthropic Console](https://platform.claude.com) | An API key for the model, with prepaid credits (a few dollars are enough)                                         | Yes, for the chat        |
| [Voyage AI](https://www.voyageai.com)            | An API key for the embedding model that turns lore text into vectors (the free allowance is far more than needed) | Yes, for lore search     |
| [Vercel](https://vercel.com)                     | Hosting the web app, with a preview URL for each pull request                                                     | Only to deploy           |
| [Google Cloud](https://cloud.google.com)         | Hosting the legacy CMS container on Cloud Run                                                                     | Only to deploy           |
| [Supabase](https://supabase.com)                 | Hosted Postgres for preview and production                                                                        | Only to deploy           |
| GitHub                                           | Hosting the code and running CI                                                                                   | Only for the CI workflow |

Create the Anthropic API key **inside a workspace** (for example the default one). A key that is not scoped to a workspace is rejected by the API.

## Run it locally

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then put your ANTHROPIC_API_KEY and VOYAGE_API_KEY in it
docker compose up --build -d                   # the legacy CMS (:8080) and Postgres (:5432)
pnpm --filter web db:migrate                   # create the database tables and enable the pgvector extension
pnpm ingest                                    # chunk and embed the lore into Postgres
pnpm dev
```

Then open http://localhost:3000 and ask "What does Kael have on them?". The app refuses to start if a required environment variable is missing, and the error message lists which ones.

## The legacy CMS

**What it is.** A small PHP (Slim) service that imitates an old system on purpose: snake_case fields, numbers stored as text, odd dates, an API key, a rate limit and random failures. It stores its data in one SQLite file with a `characters` table (five seeded characters in two worlds) and a `rate_limit` table. The data and the API are described in [`docs/reports/day-1.md`](docs/reports/day-1.md) and in [`services/legacy-cms/openapi.yaml`](services/legacy-cms/openapi.yaml).

**Run it with Docker** (as above). The database file is created and seeded when the container starts, and it is reset every time a new container starts. Check it:

```sh
curl http://localhost:8080/health
curl -H "X-API-Key: dev-local-key" http://localhost:8080/v1/characters/4/state
```

**Run it without Docker** (needs PHP 8.2 or newer with `pdo_sqlite`, and Composer):

```sh
cd services/legacy-cms
composer install
export LEGACY_API_KEY=dev-local-key LEGACY_DB_PATH=./data/legacy.sqlite
php bin/init-db.php                    # creates the tables and the seed data
php -S 127.0.0.1:8080 -t public
```

**Settings** (environment variables of the CMS):

| Variable                                         | Default              | Meaning                                              |
| ------------------------------------------------ | -------------------- | ---------------------------------------------------- |
| `LEGACY_API_KEY`                                 | none                 | The key every `/v1` request must send in `X-API-Key` |
| `LEGACY_DB_PATH`                                 | `data/legacy.sqlite` | Where the SQLite file is created                     |
| `LEGACY_RATE_LIMIT_PER_MIN`                      | 30                   | Requests per minute per key                          |
| `LEGACY_SIMULATE_FLAKINESS`                      | true                 | Random delays and failures                           |
| `LEGACY_FAILURE_RATE`                            | 0.05                 | Share of calls that fail with `503`                  |
| `LEGACY_MIN_LATENCY_MS`, `LEGACY_MAX_LATENCY_MS` | 200, 1500            | Range of the random delay                            |

The web app reads `LEGACY_CMS_URL` and `LEGACY_CMS_API_KEY` (the same value as `LEGACY_API_KEY`).

**Deploy it to Google Cloud Run** (needs the `gcloud` CLI, a project with billing, and the Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs enabled):

```sh
printf 'a-long-random-key' | gcloud secrets create legacy-cms-api-key --data-file=-
gcloud secrets add-iam-policy-binding legacy-cms-api-key \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
gcloud run deploy legacy-cms --source services/legacy-cms --region europe-west1 \
  --allow-unauthenticated --max-instances 1 \
  --set-secrets LEGACY_API_KEY=legacy-cms-api-key:latest
```

`--max-instances 1` keeps one copy of the SQLite file and the rate-limit counters. The service is public and protected only by its API key and rate limit, which is fine for a mock. Use the printed service URL as `LEGACY_CMS_URL`.

## Postgres

**Locally,** `docker compose up -d postgres` starts Postgres with the pgvector extension (`pgvector/pgvector:pg17`, user, password and database all `loreweaver`). The default `DATABASE_URL` in `.env.example` points to it. Create or update the tables with:

```sh
pnpm --filter web db:migrate
```

Check it: `docker compose exec postgres psql -U loreweaver -d loreweaver -c "\dt"`.

**Changing the schema.** Edit `apps/web/src/db/schema.ts`, run `pnpm --filter web db:generate` to create a migration in `apps/web/drizzle/`, commit it, then run `db:migrate` against each database.

**Hosted (Supabase).** Create a project in a region near your other services and save its database password. In the project's Connect dialog, copy the **Transaction pooler** connection string and use it as `DATABASE_URL` in your hosting environment. Create the tables once with the direct or session connection string:

```sh
DATABASE_URL="<supabase connection string>" pnpm --filter web db:migrate
```

On Windows PowerShell, set the variable first with `$env:DATABASE_URL = "..."`. The table has Row Level Security switched on, with no policies, so Supabase's own web API cannot read or write it. The app connects as the database owner, which bypasses it.

## Lore and ingestion

The lore lives in `data/lore/<world_id>/*.md`, one folder per world. The folder name is the world's id and must match the id used by the legacy CMS (`world_aethel`, `world_nox`). Each file starts with a front matter block (`doc_type: rule | location | history | character`), then a `#` title and `##` / `###` sections. The format is described in [`data/lore/README.md`](data/lore/README.md).

```sh
pnpm ingest                         # default chunking configuration, every world
pnpm ingest --world world_aethel    # only one world (repeat the flag for more)
pnpm ingest --config all            # every chunking configuration (see apps/web/src/lib/rag/chunking.ts)
pnpm ingest --dry-run               # chunk only: print the sizes, no database, no API call
```

- **What it does.** It reads the files, cuts each one at its headings (and, if a section is longer than the size cap, at paragraphs and sentences, with a little overlap), and embeds every chunk with the model in `EMBEDDING_MODEL`. One row per chunk goes into the `lore_chunks` table: the text, its vector, the world, the file, the heading path and the kind of document. The files are the source of truth; the table is an index that can always be rebuilt.
- **It is safe to run again.** Each chunk stores a hash of the embedding model and the exact text that was embedded. A second run on unchanged files embeds nothing and costs nothing; after an edit, only the changed chunks are embedded; stored chunks that no longer exist are removed. Changing `EMBEDDING_MODEL` re-embeds everything.
- **Cost.** It prints the tokens the provider billed and the cost at list price. The whole current lore is about 6,000 tokens, a fraction of a cent.
- **Where it writes.** To the database in `DATABASE_URL`: the local container by default. To fill the hosted database, set the variable for one command (PowerShell: `$env:DATABASE_URL = "<supabase pooled string>"; pnpm ingest`, then close the shell or remove the variable). Vectors have 1024 dimensions and the table has no vector index: at this size an exact scan is fast and always exact.

## Searching the lore

The chat has a tool, `search_lore`, that the model calls for questions about how the world works (rules, places, history, backstories). It embeds the question with the same model as the chunks, asks Postgres for the nearest chunks by cosine distance, and returns the top 3 (at most 8) with a citation id, the file and the heading. The browser draws each one as a collapsible card; the answer cites passages as `[id]`.

- **Worlds are separate.** The tool has no world parameter. The server reads the visitor's world from a cookie (a stand-in for a signed-in author's world, set by the World selector in the header, see `apps/web/src/lib/session.ts`) and puts it in the SQL `WHERE` clause, so a chunk of another world can never be a candidate. The model cannot see or change it. A test against a real Postgres proves that a query in one world never returns another world's chunks.
- **Characters are scoped too.** The character tool answers another world's character exactly like a missing one, and the prompt lists only the characters of the visitor's world.
- **Off-topic means nothing.** Passages below a similarity floor (`MIN_SIMILARITY` in `apps/web/src/lib/rag/search.ts`) are dropped, so an off-topic question returns no passages. A question that names real things of the lore but is not answered by it can still return passages: the assistant is told to say that the lore does not cover it.
- **The cookie is not authentication.** Anyone can pick any known world. The stand-in exists so that the rule "the world comes from the session, never from the model" has one place to live.

## Environment variables of the web app

Set them in `apps/web/.env.local` locally, and in your hosting provider's settings for preview and production. Never commit real values.

| Variable                 | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `LEGACY_CMS_URL`         | Base URL of the legacy CMS (`http://localhost:8080` locally)                           |
| `LEGACY_CMS_API_KEY`     | The CMS API key (`dev-local-key` locally)                                              |
| `ANTHROPIC_API_KEY`      | Your Anthropic API key. Use a separate key for production so each can be rotated alone |
| `DATABASE_URL`           | Postgres connection string (local Docker, or the Supabase pooled string when hosted)   |
| `VOYAGE_API_KEY`         | Your Voyage AI API key, for embeddings. Use a separate key for production              |
| `EMBEDDING_MODEL`        | The embedding model (`voyage-4-lite`). Chunks and queries must use the same one        |
| `AGENT_MAX_ITERATIONS`   | Optional. How many times a draft may be sent back for a revision (0 to 5, default 2)   |
| `RATE_LIMIT_PER_MINUTE`  | Optional. The most chat requests one visitor may start in a minute (default 10)        |
| `DAILY_TOKEN_BUDGET`     | Optional. The most tokens one visitor may spend in a UTC day (default 200000)          |
| `LANGSMITH_TRACING`      | Optional. `true` sends a trace of every agent run to LangSmith; unset sends nothing    |
| `LANGSMITH_API_KEY`      | A LangSmith service key. Use a separate key for production                             |
| `LANGSMITH_PROJECT`      | The project the traces go to (`loreweaver-dev`, or `loreweaver-prod` in production)    |
| `LANGSMITH_ENDPOINT`     | The API address of the LangSmith region (`https://eu.api.smith.langchain.com` for EU)  |
| `LANGSMITH_WORKSPACE_ID` | The workspace to write to. Needed by a key that covers the whole organization          |

## Deploying the web app

On Vercel, import the GitHub repository and set the project's **Root Directory** to `apps/web`. Add the six required variables above for Preview and Production (`AGENT_MAX_ITERATIONS`, `RATE_LIMIT_PER_MINUTE` and `DAILY_TOKEN_BUDGET` are optional). To trace the agent, also add the four `LANGSMITH_*` variables: Preview uses the `loreweaver-dev` key and project, Production the `loreweaver-prod` ones. `apps/web/vercel.json` pins the function region to Paris (`cdg1`), near the CMS in `europe-west1`. Every pull request gets a preview URL and every merge to `main` updates production.

## Scripts

| Command                         | What it does                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                      | Start the web app in development mode                                       |
| `pnpm test`                     | Run unit tests (database tests: see below)                                  |
| `pnpm lint`                     | Lint with ESLint                                                            |
| `pnpm typecheck`                | Type-check with TypeScript                                                  |
| `pnpm format`                   | Format the whole repo with Prettier                                         |
| `pnpm ingest`                   | Chunk and embed the lore into Postgres (idempotent; `--dry-run` to preview) |
| `pnpm eval`                     | Run the agent on the end-to-end eval set and grade every answer             |
| `pnpm eval:retrieval`           | Score the lore search on its own against a labeled set of questions         |
| `pnpm measure:retrieval`        | Time the lore search: embedding the question, and the vector search         |
| `pnpm measure:search-tool`      | Time the chat's `search_lore` tool on any running app, deployed or local    |
| `pnpm --filter web db:generate` | Create a database migration from the schema                                 |
| `pnpm --filter web db:migrate`  | Apply migrations to the database in `DATABASE_URL`                          |
| `pnpm measure:legacy`           | Load-test the legacy CMS and its client                                     |
| `pnpm benchmark`                | Compare two models on the same five prompts through the chat route          |
| `pnpm measure:chat`             | Time the chat with its tool: time to first UI, card, first token, total     |
| `pnpm measure:agent`            | Run the agent prompt set and measure the reflection loop                    |
| `pnpm cost:report`              | Cost, tokens and latency per query from the LangSmith traces                |

**Database tests.** One test file checks the world separation against a real Postgres with pgvector. It runs only when `TEST_DATABASE_URL` points at a migrated database, and is skipped otherwise (CI always sets it, and fails if it is missing). It adds rows for its own test worlds and removes them afterwards. Use the local container, never a shared or hosted database. PowerShell: `$env:TEST_DATABASE_URL = "postgresql://loreweaver:loreweaver@localhost:5432/loreweaver"; pnpm test`.

## Measurements

Every number reported about the project is recorded in [`docs/METRICS.md`](docs/METRICS.md), with how it was measured and the command that reproduces it. The comparison of Claude Haiku 4.5 and Sonnet 5.5 behind the choice of model is in [`docs/BENCHMARK.md`](docs/BENCHMARK.md). `pnpm benchmark` and `pnpm measure:chat` spend a few cents of model credit per run.

## Docs

- [Product requirements](docs/PRD.md)
- [Architecture decisions](docs/adr/)
- [Agent design](docs/AGENT_DESIGN.md): the graph that drafts, checks and revises answers
- [Evals](evals/README.md): the retrieval eval, the agent prompt set and the end-to-end eval with its judge
- [Metrics](docs/METRICS.md) and [model benchmark](docs/BENCHMARK.md)
- [Daily reports](docs/reports/): [Day 1](docs/reports/day-1.md), [Day 2](docs/reports/day-2.md), [Day 3](docs/reports/day-3.md), [Day 4](docs/reports/day-4.md)

## Layout

```
apps/web/            Next.js app: chat page, API routes, database schema and migrations, ingestion script
data/lore/           The lore of each world, as Markdown files (the source of the search index)
evals/               Evaluation data and code: retrieval, agent prompts, end-to-end
services/legacy-cms/ The legacy CMS (PHP, Slim, SQLite) and its OpenAPI contract
packages/shared/     Reserved for code shared between projects (empty so far)
docs/                PRD, ADRs, metrics, benchmark and daily reports
docker-compose.yml   The legacy CMS and Postgres for local development
.github/workflows/   CI: format, lint, types and tests on every pull request
```

## License

[MIT](LICENSE)
