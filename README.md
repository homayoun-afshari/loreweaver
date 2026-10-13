# Loreweaver

[![CI](https://github.com/homayoun-afshari/loreweaver/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/homayoun-afshari/loreweaver/actions/workflows/ci.yml)
[![Eval gate](https://github.com/homayoun-afshari/loreweaver/actions/workflows/eval.yml/badge.svg)](https://github.com/homayoun-afshari/loreweaver/actions/workflows/eval.yml)
[![Live demo](https://img.shields.io/badge/demo-live-000000?logo=vercel&logoColor=white)](https://loreweaver-nine.vercel.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](.nvmrc)
[![pnpm 12](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](apps/web/tsconfig.json)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](apps/web/package.json)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](apps/web/package.json)
[![Vercel AI SDK 7](https://img.shields.io/badge/Vercel_AI_SDK-7-000000?logo=vercel&logoColor=white)](apps/web/package.json)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.4-1C3C3C?logo=langchain&logoColor=white)](docs/AGENT_DESIGN.md)
[![Claude](https://img.shields.io/badge/Claude-Sonnet_5.5_%7C_Haiku_4.5-D97757?logo=anthropic&logoColor=white)](docs/adr/0002-model-choice.md)
[![Voyage AI](https://img.shields.io/badge/embeddings-Voyage_AI-4B5563)](docs/adr/0003-chunking-and-retrieval.md)
[![PostgreSQL 17 + pgvector](https://img.shields.io/badge/PostgreSQL-17_%2B_pgvector-4169E1?logo=postgresql&logoColor=white)](docker-compose.yml)
[![PHP 8.4](https://img.shields.io/badge/PHP-8.4-777BB4?logo=php&logoColor=white)](services/legacy-cms)
[![LangSmith](https://img.shields.io/badge/tracing-LangSmith-1C3C3C?logo=langchain&logoColor=white)](docs/METRICS.md)

A worldbuilding copilot for novelists. Pick a world and ask a question about it ("Can fire magic be cast inside the Ice Citadel?", "How can Aria get out of the Citadel?"). Loreweaver reads the world's lore and the live state of its characters, answers with options that fit the world's own rules, and cites the lore passages it used. A second model checks every draft against the rules and the character's real inventory before the author sees it. It suggests; the author decides, and it never changes the lore or the character data.

Loreweaver was built over seven days, and each day is documented by a report in [`docs/reports/`](docs/reports/). The core product was built in the first six days (Days 1 to 6); Day 7 is about making the project presentable.

## Contents

- [Architecture](#architecture)
- [What you need](#what-you-need)
- [Set up and run locally](#set-up-and-run-locally)
- [The parts in detail](#the-parts-in-detail)
- [Environment variables of the web app](#environment-variables-of-the-web-app)
- [Deploying](#deploying)
- [Tests, CI and evals](#tests-ci-and-evals)
- [Scripts](#scripts)
- [Measurements and cost](#measurements-and-cost)
- [Docs](#docs)
- [Layout](#layout)

## Architecture

[![Architecture of Loreweaver](docs/diagrams/06_Evaluation_Safety_ResponsibleAI.svg)](docs/diagrams/06_Evaluation_Safety_ResponsibleAI.svg)

How a question is answered:

1. The **browser** (the chat page and its **cards**) sends the conversation to the **app**, a Next.js server. Through the **Vercel AI SDK**, the app checks the request and turns the history into messages for the agent. It also applies the visitor's limits, recorded in the **usage database**.
2. The **agent orchestrator** (a LangGraph graph) runs the **reasoning model** (Claude). The model calls two **tools**:
   - `fetch_character_state` reads a character's live state from the **legacy CMS** (PHP, with its own SQLite **state database**), through an **anti-corruption layer** that validates the data, retries and fails safely.
   - `search_lore` embeds the question with the **embedding model** (Voyage AI) and finds the nearest lore passages in the **vector database** (Postgres with pgvector).
3. The **reflection model** checks the draft against what the tools returned. A draft that breaks a rule is revised a bounded number of times. The accepted answer is streamed back once, with the cards drawn from the tool results.
4. Each run can be traced in **LangSmith** (observability). Thumbs and copy clicks go to the **feedback database**. The **evals** run the same graph on fixed cases, with a stronger judge model, on a developer's machine and on every pull request.

The world comes from the visitor's session, never from the model, and every lookup is limited to it. The diagram above is the last of six snapshots in [`docs/diagrams/`](docs/diagrams/), one per day of the build, all on the same layout (see [Architecture diagrams](#architecture-diagrams)).

## What you need

### Tools on your machine

| Tool             | Version                                                     | Needed for                                                                           |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Git              | any recent                                                  | Cloning the repository                                                               |
| Node.js          | 24 (`24.21.0` in [`.nvmrc`](.nvmrc))                        | The web app, the scripts and the evals                                               |
| pnpm             | `12.10.1`, through Corepack (`packageManager`)              | Installing and running everything                                                    |
| Docker           | Docker Desktop, or Docker Engine with the Compose v2 plugin | The legacy CMS and Postgres on your machine                                          |
| PHP and Composer | PHP 8.2 or newer with `pdo_sqlite` (optional)               | Running the legacy CMS without Docker (the image uses PHP 8.4)                       |
| Google Cloud CLI | any recent (`gcloud`)                                       | Deploying the legacy CMS to Cloud Run                                                |
| GitHub CLI       | any recent (`gh`, optional)                                 | Pull requests and following CI from the terminal                                     |
| Python 3         | any recent (optional)                                       | Only `evals/break_prompt.py`, which breaks the prompt on purpose to test the CI gate |

On Windows, Docker Desktop uses the WSL 2 backend. On Linux, install Docker Engine and the Compose plugin, so that `docker compose` (with a space) works.

### Main libraries and models

Every dependency is pinned to an exact version in `package.json` and `pnpm-lock.yaml`. The ones that shape the code:

| Area        | What                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app     | Next.js `16.4.0`, React `19.3.0`, Tailwind CSS 4, shadcn/ui on Base UI, Zod `4.6.5`                                                                                           |
| Model layer | Vercel AI SDK `ai` `7.0.136` with `@ai-sdk/react` `4.0.139` and `@ai-sdk/langchain` `3.0.136`                                                                                 |
| Agent       | `@langchain/langgraph` `1.4.21`, `@langchain/core` `1.2.17`, `@langchain/anthropic` `1.5.12`, `langsmith` `0.10.11`                                                           |
| Database    | Postgres 17 with pgvector (`pgvector/pgvector:pg17`), Drizzle ORM `0.45.4` and Drizzle Kit `0.31.11`, `postgres` `3.4.9`                                                      |
| Lore        | `unified`, `remark-parse` and `mdast-util-to-string` (Markdown parsing for ingestion)                                                                                         |
| Tests       | Vitest `5.0.3`, msw `3.0.2` (HTTP mocking)                                                                                                                                    |
| Legacy CMS  | PHP 8.4, Slim 4, SQLite                                                                                                                                                       |
| Models      | Claude Haiku 4.5 (`claude-haiku-4-5`), Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Opus 5.5 (`claude-opus-5-5`, the eval judge only), Voyage `voyage-4-lite` (embeddings) |

Which model runs where, and why, is in [ADR-0002](docs/adr/0002-model-choice.md) and the [system card](docs/SYSTEM_CARD.md): Haiku drafts on a developer's machine and in the CI evals, Sonnet drafts in Preview and Production, and Haiku checks every draft everywhere.

### Online platforms

Only the first two are needed to run the app on your machine. The others are for deploying, tracing and CI.

| Platform                                         | What to set up                                                                                                                                                                                                                                                       | Needed for             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [Anthropic Console](https://platform.claude.com) | Prepaid credits and a monthly spend limit. API keys **inside a workspace** (for example the default one; a key outside a workspace is rejected): a `dev` key for your machine and Preview, a `prod` key for Production, and a separate CI key with its own low limit | The chat (required)    |
| [Voyage AI](https://www.voyageai.com)            | API keys: `dev`, `prod` and CI. In the organization settings, opt out of data storage and training. That setting covers every key of the organization and cannot be reversed in the dashboard (see [PRIVACY.md](docs/PRIVACY.md))                                    | Lore search (required) |
| [Supabase](https://supabase.com)                 | A project in a region near the other services (`eu-west-1` here). Save its database password. Copy the **Transaction pooler** connection string for the hosted app, and the direct or session string for migrations                                                  | Hosted Postgres        |
| [Vercel](https://vercel.com)                     | Import the GitHub repository with **Root Directory** `apps/web`, and set the variables for Preview and Production                                                                                                                                                    | Hosting the web app    |
| [Google Cloud](https://cloud.google.com)         | A project with billing and a budget alert. Enable the Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs. Region `europe-west1`                                                                                                                       | Hosting the legacy CMS |
| [LangSmith](https://smith.langchain.com)         | A workspace in the **EU** region with two projects, `loreweaver-dev` and `loreweaver-prod`, and one service key for each. Note the workspace id                                                                                                                      | Tracing (optional)     |
| [GitHub](https://github.com)                     | The repository, with two Actions secrets for the eval gate: `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`, both the CI keys. Branch protection is not available for a private repository on the free plan, so the rule there is to merge only when CI is green            | CI and the eval gate   |

## Set up and run locally

The commands below work in a macOS or Linux shell and in Windows PowerShell, except where a separate Windows line is given. Run them from the repository folder.

**1. Enable Corepack and install the dependencies.**

```sh
corepack enable    # installs pnpm 12.10.1, as pinned in package.json
pnpm install
```

On Windows, if Node.js is installed for all users, run `corepack enable` once in a terminal opened as administrator. On macOS or Linux with a system-wide Node.js, it may need `sudo`.

**2. Create the environment file** and put your `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in it. The other values already point at the local services. To trace, also fill in the `LANGSMITH_*` values; otherwise set `LANGSMITH_TRACING=false`.

```sh
cp apps/web/.env.example apps/web/.env.local                 # macOS, Linux
```

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local          # Windows PowerShell
```

**3. Start the legacy CMS and Postgres**, then create the tables and index the lore.

```sh
docker compose up --build -d     # the legacy CMS on :8080 and Postgres on :5432
pnpm --filter web db:migrate     # create the tables and enable the pgvector extension
pnpm ingest                      # chunk and embed the lore into Postgres
```

**4. Start the app.**

```sh
pnpm dev
```

Open <http://localhost:3000>, switch the world to Nox in the header, and ask "What does Kael have on them?". The app refuses to start if a required environment variable is missing, and the error lists which ones.

**Check the services by hand.** On Windows PowerShell 5.1, `curl` is a different command; type `curl.exe` instead.

```sh
curl http://localhost:8080/health
curl -H "X-API-Key: dev-local-key" http://localhost:8080/v1/characters/4/state
curl http://localhost:3000/api/health
docker compose exec postgres psql -U loreweaver -d loreweaver -c "\dt"
```

**Set a variable for one command.** Several commands below take a connection string or a key for a single run:

```sh
DATABASE_URL="<connection string>" pnpm --filter web db:migrate     # macOS, Linux
```

```powershell
$env:DATABASE_URL = "<connection string>"; pnpm --filter web db:migrate    # Windows PowerShell
Remove-Item Env:DATABASE_URL                                                # then clear it
```

**Stop everything.** `docker compose down` stops the containers and keeps the database volume. `docker compose down -v` also deletes the volume, so the next start needs `db:migrate` and `pnpm ingest` again.

## The parts in detail

### The legacy CMS

**What it is.** A small PHP (Slim) service that owns the live state of characters and imitates an old system on purpose: snake_case fields, numbers stored as text, odd dates, an API key, a rate limit and random failures. It keeps its data in one SQLite file, with a `characters` table (five seeded characters in two worlds) and a `rate_limit` table. The data and the API are described in the [Day 1 report](docs/reports/day-1.md) and in [`openapi.yaml`](services/legacy-cms/openapi.yaml).

| Endpoint                                       | Purpose                            | API key |
| ---------------------------------------------- | ---------------------------------- | ------- |
| `GET /health`                                  | Is the service alive?              | No      |
| `GET /v1/characters/{id}/state`                | One character's full state         | Yes     |
| `GET /v1/characters?world_id=&page=&per_page=` | Characters of one world, paginated | Yes     |

**With Docker** (as above), the database file is created and seeded when the container starts, and reset every time a new container starts.

**Without Docker** (PHP 8.2 or newer with `pdo_sqlite`, and Composer):

```sh
cd services/legacy-cms
composer install
export LEGACY_API_KEY=dev-local-key LEGACY_DB_PATH=./data/legacy.sqlite      # macOS, Linux
php bin/init-db.php                      # creates the tables and the seed data
php -S 127.0.0.1:8080 -t public
```

On Windows PowerShell, replace the `export` line with `$env:LEGACY_API_KEY = "dev-local-key"; $env:LEGACY_DB_PATH = "./data/legacy.sqlite"`.

**Settings** (environment variables of the CMS):

| Variable                                         | Default              | Meaning                                              |
| ------------------------------------------------ | -------------------- | ---------------------------------------------------- |
| `LEGACY_API_KEY`                                 | none                 | The key every `/v1` request must send in `X-API-Key` |
| `LEGACY_DB_PATH`                                 | `data/legacy.sqlite` | Where the SQLite file is created                     |
| `LEGACY_RATE_LIMIT_PER_MIN`                      | 30                   | Requests per minute per key                          |
| `LEGACY_SIMULATE_FLAKINESS`                      | true                 | Random delays and failures                           |
| `LEGACY_FAILURE_RATE`                            | 0.05                 | Share of calls that fail with `503`                  |
| `LEGACY_MIN_LATENCY_MS`, `LEGACY_MAX_LATENCY_MS` | 200, 1500            | Range of the random delay                            |

The web app reads `LEGACY_CMS_URL` and `LEGACY_CMS_API_KEY` (the same value as `LEGACY_API_KEY`). Its client (`apps/web/src/lib/legacy/`) is the only code that talks to the CMS. It validates every response, maps the legacy fields to a clean model, and protects the app with a timeout, retries with backoff, a circuit breaker and typed errors. An unavailable CMS is reported as possibly stale, never guessed.

### Postgres

**Locally,** `docker compose up -d postgres` starts Postgres 17 with the pgvector extension. The user, password and database are all `loreweaver`, and the default `DATABASE_URL` in `.env.example` points to it. It holds three tables:

| Table             | Holds                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `lore_chunks`     | The lore passages with their vectors (an index that `pnpm ingest` can always rebuild)                  |
| `feedback_events` | One row per thumbs up, thumbs down or copy click: ids, model and prompt version, no text               |
| `usage_events`    | One row per accepted chat request: visitor id, world, model, tokens, cost, latency and status, no text |

All three have Row Level Security switched on with no policies, so Supabase's own web API cannot read or write them. The app connects as the database owner, which bypasses it. What is stored and for how long is in [PRIVACY.md](docs/PRIVACY.md).

**Changing the schema.** Edit `apps/web/src/db/schema.ts`, run `pnpm --filter web db:generate` to create a migration in `apps/web/drizzle/`, commit it, then run `db:migrate` against each database. Migrations are not part of a deploy; they are applied by hand.

### Lore and ingestion

The lore lives in `data/lore/<world_id>/*.md`, one folder per world. The folder name is the world's id and must match the id used by the legacy CMS (`world_aethel`, `world_nox`). Each file starts with a front matter block (`doc_type: rule | location | history | character`), then a `#` title and `##` / `###` sections. The format is in [`data/lore/README.md`](data/lore/README.md).

```sh
pnpm ingest                         # default chunking configuration, every world
pnpm ingest --world world_aethel    # only one world (repeat the flag for more)
pnpm ingest --config all            # every chunking configuration (see apps/web/src/lib/rag/chunking.ts)
pnpm ingest --dry-run               # chunk only: print the sizes, no database, no API call
```

- **What it does.** It reads the files and cuts each one at its headings. A section longer than the size cap is also cut at paragraphs and sentences, with a little overlap. It embeds every chunk with the model in `EMBEDDING_MODEL`. One row per chunk goes into `lore_chunks`: the text, its vector, the world, the file, the heading path and the kind of document. The files are the source of truth.
- **It is safe to run again.** Each chunk stores a hash of the embedding model and the exact text that was embedded. A second run on unchanged files embeds nothing. After an edit, only the changed chunks are embedded, and stored chunks that no longer exist are removed. Changing `EMBEDDING_MODEL` re-embeds everything.
- **Cost.** It prints the tokens the provider billed and their cost at list price. The cost of indexing the current lore is in [METRICS.md](docs/METRICS.md).
- **Where it writes.** To the database in `DATABASE_URL`, which is the local container by default. To fill the hosted database, set the variable for one command (see [Set a variable for one command](#set-up-and-run-locally)). Vectors have 1024 dimensions, and the table has no vector index: at this size an exact scan is fast and always exact.

### Searching the lore

The model calls the `search_lore` tool for questions about how the world works (rules, places, history, backstories). The tool:

1. embeds the question with the same model as the chunks;
2. asks Postgres for the nearest chunks by cosine distance;
3. drops those below a similarity floor (`MIN_SIMILARITY` in `apps/web/src/lib/rag/search.ts`);
4. returns the top 3 (at most 8), each with a citation id, the file and the heading.

The browser draws each passage as a collapsible **Lore Citation** card, and the answer cites passages as `[id]`.

- **Worlds are separate.** The tool has no world parameter. The server reads the visitor's world from a cookie (`lw_world`, set by the World selector in the header) and puts it in the SQL `WHERE` clause, so a chunk of another world can never be a candidate. A test against a real Postgres proves it.
- **Characters are scoped too.** The character tool answers about another world's character exactly as it answers about a missing one, and the prompt lists only the characters of the visitor's world.
- **Off-topic means nothing.** An off-topic question returns no passages. A question that names real things of the lore but is not answered by it can still return some, and the assistant is told to say that the lore does not cover it.
- **The cookie is not authentication.** There is no sign-in, so anyone can pick any known world. The cookie is a stand-in that keeps the rule "the world comes from the session, never from the model" in one place (`apps/web/src/lib/session.ts`).

### The agent

The chat route runs a LangGraph graph with three nodes: **agent** (the drafting model, which calls the tools or writes a draft), **tools**, and **reflect** (a cheaper model at temperature 0 that checks the draft against this run's tool results and returns a structured verdict).

- A draft that fails the check is revised, at most `AGENT_MAX_ITERATIONS` times (default 2).
- A run that has taken more than 12 seconds starts no further revision.
- At a limit, the best draft goes out with a caveat, built by code, that lists what is unresolved.
- Draft text and verdicts never leave the server. The cards appear as the tools finish, a status note shows while a draft is checked, and the answer arrives once.

Defenses that do not depend on the model behaving:

- Lore passages are marked as data before the model reads them.
- An answer that copies the system prompt or names a world id is replaced.
- A message is at most 8,000 characters: the text box shows a counter, and the server answers HTTP 413.
- Every model call writes at most 1,024 tokens.

The design is in [AGENT_DESIGN.md](docs/AGENT_DESIGN.md) and [ADR-0004](docs/adr/0004-orchestration-vs-ui-streaming.md). The system prompts are versioned files in `apps/web/src/lib/prompts/` (the app uses `agent.v6`).

### Tracing, cost and limits

- **Tracing.** With `LANGSMITH_TRACING=true` and a key, every agent run is sent to LangSmith as a tree of nodes, model calls and tool calls. Each run is labeled with `env`, `model` and `prompt_version`.
  - Development, scripts and Preview write to `loreweaver-dev`; Production writes to `loreweaver-prod`.
  - Traces are sent after the response, so the answer is not delayed.
  - A trace holds the author's question, the passages and the answer (see [PRIVACY.md](docs/PRIVACY.md)). Tracing is off in CI and in the evals.
- **Cost report.** `pnpm cost:report` reads the traces back and prices every model call by the model that made it. It reports the tokens by kind, the cost and the latency of each question, their mean, median and p95, the cache hit rate and a monthly projection. It calls no model. Prices live in `apps/web/src/lib/ai/models.ts`, with the date they were read.
- **Prompt caching.** The drafting model caches the tool definitions and the system prompt. It helps Sonnet only, since Haiku's minimum cacheable prompt is longer than this one.
- **Consumption limits.** There is no sign-in, so each browser gets a random visitor id in an HttpOnly cookie (`lw_visitor`).
  - A visitor may start `RATE_LIMIT_PER_MINUTE` chat requests a minute (default 10) and spend `DAILY_TOKEN_BUDGET` tokens a UTC day (default 200,000).
  - Over a limit, the route answers `429` with a sentence and a `Retry-After` header, and no model is called.
  - If the database fails, the limits fail open and the error is logged.

## Environment variables of the web app

Set them in `apps/web/.env.local` locally, and in your hosting provider's settings for Preview and Production. Never commit real values; [`apps/web/.env.example`](apps/web/.env.example) lists them with comments.

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

The first six are required. The model is not a setting: it is chosen from the environment (`VERCEL_ENV`), and callers cannot change it in Preview or Production.

## Deploying

The pieces live in the EU wherever the project can choose: the functions in Paris, the CMS in `europe-west1`, the database in `eu-west-1` and the traces in LangSmith's EU region. Preview and Production share one Supabase project, and with it the lore and the logs.

### The legacy CMS on Google Cloud Run

You need the `gcloud` CLI and the project from [Online platforms](#online-platforms).

1. Store the API key in Secret Manager, without a trailing newline:

   ```sh
   printf 'a-long-random-key' | gcloud secrets create legacy-cms-api-key --data-file=-     # macOS, Linux
   ```

   ```powershell
   # Windows PowerShell: piping a string adds a newline, so write the key to a file first
   Set-Content -NoNewline -Path key.txt -Value "a-long-random-key"
   gcloud secrets create legacy-cms-api-key --data-file=key.txt
   Remove-Item key.txt
   ```

2. Let Cloud Run read it, and deploy from the source (Cloud Build builds the image):

   ```sh
   gcloud secrets add-iam-policy-binding legacy-cms-api-key \
     --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
     --role=roles/secretmanager.secretAccessor
   gcloud run deploy legacy-cms --source services/legacy-cms --region europe-west1 \
     --allow-unauthenticated --max-instances 1 \
     --set-secrets LEGACY_API_KEY=legacy-cms-api-key:latest
   ```

   In PowerShell, end the continued lines with a backtick (`` ` ``) instead of `\`, or write each command on one line.

`--max-instances 1` keeps one copy of the SQLite file and the rate-limit counters. The service is public and protected only by its API key and rate limit, which is fine for a mock. Use the printed service URL as `LEGACY_CMS_URL`.

### The database on Supabase

Create the tables once, with the direct or session connection string, then fill the lore index with the same string (see [Set a variable for one command](#set-up-and-run-locally) for the Windows form):

```sh
DATABASE_URL="<supabase connection string>" pnpm --filter web db:migrate
DATABASE_URL="<supabase connection string>" pnpm ingest
```

Apply every new migration the same way **before** the code that needs it is deployed. The app itself uses the **Transaction pooler** string as `DATABASE_URL`. The Supabase Security Advisor reports the `vector` extension in the `public` schema; it stays there on purpose, so the local and hosted databases are identical.

### The web app on Vercel

1. Import the GitHub repository and set the project's **Root Directory** to `apps/web`.
2. Add the six required variables for Preview and Production. The `dev` keys go to Preview and the `prod` keys to Production.
3. To trace, also add the `LANGSMITH_*` variables: Preview uses the `loreweaver-dev` key and project, Production the `loreweaver-prod` ones.

`apps/web/vercel.json` pins the function region to Paris (`cdg1`), near the CMS. Every pull request gets a preview URL, and every merge to `main` updates Production. `GET /api/health` reports the environment and the commit, to show which deployment is live.

### GitHub Actions

Add the CI keys as the Actions secrets `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` (Settings, Secrets and variables, Actions). Pull requests from forks do not receive secrets, so their eval job fails with a message.

## Tests, CI and evals

**Unit tests** (`pnpm test`, Vitest) need no network, model or key: the models are scripted fakes and HTTP is mocked. A few tests check the world separation and the usage store against a real Postgres with pgvector. They run only when `TEST_DATABASE_URL` points at a migrated database, and are skipped otherwise. They add rows for their own test worlds and remove them afterwards, so use the local container, never a shared or hosted database.

```sh
TEST_DATABASE_URL="postgresql://loreweaver:loreweaver@localhost:5432/loreweaver" pnpm test      # macOS, Linux
```

```powershell
$env:TEST_DATABASE_URL = "postgresql://loreweaver:loreweaver@localhost:5432/loreweaver"; pnpm test    # Windows PowerShell
```

**CI** has two workflows:

| Workflow                                          | When                                                                                    | What it does                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml) (`check`)    | Every pull request and push to `main`                                                   | Installs with the frozen lockfile, then runs `format:check`, `lint` and `typecheck`. It starts a throw-away Postgres with pgvector, applies the migrations and runs the tests, the database tests included (it fails if the database is missing). It does not run `next build`; the Vercel preview does |
| [`eval.yml`](.github/workflows/eval.yml) (`eval`) | Pull requests that change the app's code, the lore, the CMS, the evals or the lock file | Starts Postgres and the CMS with Docker Compose, migrates and ingests. It then runs the smoke set and the red-team set with Haiku as the agent and the Opus judge, and fails on a drop in faithfulness or on any successful attack. Other pull requests skip it at no cost                              |

The eval gate is a coarse alarm. One run of ten cases varies on its own, so re-run a red job once before looking for a cause.

**Evals** (described in [`evals/README.md`](evals/README.md)):

- **Retrieval** (`pnpm eval:retrieval`): scores the lore search on its own against labeled questions. It calls no model.
- **End to end** (`pnpm eval`): runs the whole agent on cases built from the seed data. Each answer is graded by code (tools, items, citations) and by a judge model against hand-written constraints.
- **Judge check** (`pnpm eval:labels`): compares the judge with a person's labels.
- **Red team** (`pnpm eval:redteam`): attacks the agent with prompt injection (direct and hidden in the lore), another world's data, a harmful request dressed as fiction and cost attacks.
- **Summary** (`pnpm eval:summary`): puts the summaries of stored reports side by side.

## Scripts

Run them from the repository folder.

| Command                                | What it does                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                             | Start the web app in development mode                                       |
| `pnpm test`                            | Run the unit tests (database tests: see above)                              |
| `pnpm lint`                            | Lint with ESLint                                                            |
| `pnpm typecheck`                       | Type-check with TypeScript                                                  |
| `pnpm format`                          | Format the whole repository with Prettier                                   |
| `pnpm format:check`                    | Check the formatting, as CI does                                            |
| `pnpm --filter web build`              | Build the web app for production, as Vercel does                            |
| `pnpm --filter web db:generate`        | Create a database migration from the schema                                 |
| `pnpm --filter web db:migrate`         | Apply the migrations to the database in `DATABASE_URL`                      |
| `pnpm ingest`                          | Chunk and embed the lore into Postgres (idempotent; `--dry-run` to preview) |
| `pnpm eval`                            | Run the agent on the end-to-end eval set and grade every answer             |
| `pnpm eval:redteam`                    | Attack the agent with the red-team set and check that it holds              |
| `pnpm eval:labels`                     | Compare the eval judge with hand labels (writes the sheet, then scores it)  |
| `pnpm eval:summary`                    | Compare stored eval reports side by side (no model call)                    |
| `pnpm eval:retrieval`                  | Score the lore search on its own against a labeled set of questions         |
| `pnpm benchmark`                       | Compare two models on the same five prompts through the chat route          |
| `pnpm measure:legacy`                  | Load-test the legacy CMS and its client                                     |
| `pnpm measure:chat`                    | Time the chat with its tool: time to first UI, card, first token, total     |
| `pnpm measure:retrieval`               | Time the lore search: embedding the question, and the vector search         |
| `pnpm measure:search-tool`             | Time the chat's `search_lore` tool on any running app, deployed or local    |
| `pnpm measure:agent`                   | Run the agent prompt set and measure the reflection loop                    |
| `pnpm cost:report`                     | Cost, tokens and latency per query from the LangSmith traces                |
| `node docs/diagrams/scripts/build.mjs` | Rebuild the architecture diagrams                                           |

## Measurements and cost

Every number reported about the project is recorded in [`docs/METRICS.md`](docs/METRICS.md), with how it was measured, the commit it belongs to, the command that reproduces it and what a run costs. The comparison of Claude Haiku 4.5 and Sonnet 5.5 behind the choice of model is in [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

Some commands spend money:

- **Model credit:** `pnpm benchmark`, `pnpm measure:chat`, `pnpm measure:agent`, `pnpm eval` and `pnpm eval:redteam`. The two evals also call the judge model, so they are the most expensive.
- **Embedding credit:** `pnpm ingest`, `pnpm eval:retrieval` and the lore search, for a fraction of a cent.
- **Free:** the unit tests, `pnpm eval:summary`, `pnpm eval:labels` and `pnpm cost:report`.

The cost of each run is listed with its entry in METRICS.md.

## Docs

- [Product requirements](docs/PRD.md): the problem, the personas, the scope and the success metrics
- [Architecture decisions](docs/adr/):
  - [ADR-0001](docs/adr/0001-standalone-legacy-service.md): a stand-alone legacy service
  - [ADR-0002](docs/adr/0002-model-choice.md): the model choice
  - [ADR-0003](docs/adr/0003-chunking-and-retrieval.md): chunking and retrieval
  - [ADR-0004](docs/adr/0004-orchestration-vs-ui-streaming.md): orchestration apart from UI streaming
- [Architecture diagrams](docs/diagrams/): six snapshots of the architecture, one per day of the build
- [Agent design](docs/AGENT_DESIGN.md): the graph that drafts, checks and revises answers, and its guardrails
- [Evals](evals/README.md): the retrieval eval, the agent prompt set, the end-to-end eval with its judge, the red-team set and the CI gate
- [Metrics](docs/METRICS.md) and [model benchmark](docs/BENCHMARK.md)
- [System card](docs/SYSTEM_CARD.md): what the agent is for and not for, how it was checked, its limits and who stays in charge
- [Privacy](docs/PRIVACY.md): where the data goes, what is stored and for how long, and how a world's data is deleted
- Daily reports: [Day 1](docs/reports/day-1.md), [Day 2](docs/reports/day-2.md), [Day 3](docs/reports/day-3.md), [Day 4](docs/reports/day-4.md), [Day 5](docs/reports/day-5.md), [Day 6](docs/reports/day-6.md)

### Architecture diagrams

[`docs/diagrams/`](docs/diagrams/) holds one snapshot per day of the build. All six use the same canvas and keep every module in the same place, so the snapshots can be compared side by side:

1. [Product Discovery, Legacy CMS & Scaffolding](docs/diagrams/01_ProductDiscovery_LegacyCMS_Scaffolding.svg)
2. [Model Layer, Streaming & Generative UI](docs/diagrams/02_ModelLayer_Streaming_GenerativeUI.svg)
3. [Lore, Embeddings & Retrieval](docs/diagrams/03_Lore_Embeddings_Retrieval.svg)
4. [Agentic Orchestration & Reflection](docs/diagrams/04_AgenticOrchestration_Reflection.svg)
5. [Observability, Token Economics & Performance](docs/diagrams/05_Observability_TokenEconomics_Performance.svg)
6. [Evaluation, Safety & Responsible AI](docs/diagrams/06_Evaluation_Safety_ResponsibleAI.svg)

Each module shows:

- its location (the badge);
- its main tools;
- its most important operations;
- what it runs on in development, Preview and Production.

The diagrams are generated by [`docs/diagrams/scripts/build.mjs`](docs/diagrams/scripts/build.mjs), a plain Node script with no dependencies. To change one, edit the script and run `node docs/diagrams/scripts/build.mjs`.

## Layout

```text
apps/web/              Next.js app: chat page, API routes, agent graph, database schema and migrations, scripts
data/lore/             The lore of each world, as Markdown files (the source of the search index)
evals/                 Eval datasets, runners, judge, labels and the reports that documents rely on
services/legacy-cms/   The legacy CMS (PHP, Slim, SQLite) and its OpenAPI contract
packages/shared/       Reserved for code shared between projects (empty so far)
docs/                  PRD, ADRs, agent design, system card, privacy, metrics, benchmark and daily reports
docs/diagrams/         The architecture diagrams and the script that generates them
docker-compose.yml     The legacy CMS and Postgres for local development
.github/workflows/     CI: format, lint, types and tests on every pull request, and the eval gate
```

## License

[MIT](LICENSE)
