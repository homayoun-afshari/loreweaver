# Day 5 report: Observability, token economics and performance

## 1. Summary

Day 5 made the agent visible, priced and bounded:

- **Every agent run is traced** in LangSmith, labeled with the environment, the drafting model and the prompt version, in one project for development and Preview and another for Production.
- **A cost report** reads the traces back and works out, for every question, the tokens by type, the cost and the end-to-end latency, with the mean, the median, the p95 and a monthly projection for any number of authors.
- **Prompt caching** is on for the drafting model: the tool definitions and the system prompt, which every model call of a question repeats, are cached.
- **Consumption limits.** Every chat request is recorded in a new table, and each visitor has a rate limit (requests per minute) and a daily token budget. A visitor over a limit gets a clear message and no model is called.
- A `/cost-check` command for Claude Code that reconciles the traced cost with the Anthropic Console.

The product can now say what a question costs and where its time goes, and one visitor can no longer spend without bound.

## 2. Learn, Prepare and Build

| Section                     | What was done                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                   | Traces, spans and runs; token economics (input, cached, output and reasoning tokens are priced apart); the levers for cost and for latency; and what a trace exposes about the authors.                                                                                      |
| **Prepare**                 | A LangSmith workspace in the EU region with two projects, `loreweaver-dev` and `loreweaver-prod`, and one service key for each. The `langsmith` SDK became a direct dependency (exact version). Current prices, spend limits and the caching rules of the models were noted. |
| **Build A: Tracing**        | The tracing variables, the labels on every run, and a flush of pending traces after the response so a serverless function does not lose them.                                                                                                                                |
| **Build B: Filling traces** | The agent prompt set, the Ice Citadel question in the chat and a question with the legacy service down were run, and traces were read node by node. No code changed.                                                                                                         |
| **Build C: Cost report**    | `pnpm cost:report`, its arithmetic and tests, and the price of cached tokens in the model table.                                                                                                                                                                             |
| **Build D: Prompt caching** | A cache marker on the system prompt of the drafting model, on the calls that offer the tools.                                                                                                                                                                                |
| **Build E: Guardrails**     | The `usage_events` table, the visitor cookie, the two limits, the message in the chat, and the token counts of the agent extended with the cached tokens.                                                                                                                    |

## 3. By area

**Frontend**

| Item                  | What it is                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatPanel` (changed) | When the route refuses a request because of a limit, it shows the sentence the route sent instead of the generic failure, and hides Retry and Regenerate for a spent day. |
| `limit-error.ts`      | Reads that answer from the error of the chat library (the failed response's text), and refuses anything that is not exactly its shape.                                    |

**Backend**

| Item                           | What it is                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/chat/route.ts`    | Labels the run, flushes traces, asks the usage guard before the agent runs (section 9), and records what the run used when it ends, also if it failed or was stopped.                                                        |
| `src/lib/agent/config.ts`      | `agentRunConfig` takes the trace labels and adds them as metadata, which every run of a trace inherits.                                                                                                                      |
| `src/lib/ai/tracing.ts`        | Keeps the function alive after the response until the traces are sent.                                                                                                                                                       |
| `src/lib/agent/models.ts`      | Marks the system prompt as a cache breakpoint on the drafting calls that offer the tools. The last call of a draft, which has no tools, is sent without a marker.                                                            |
| `src/lib/agent/state.ts`       | The token counts of a run now include the tokens read from and written to the cache.                                                                                                                                         |
| `src/lib/ai/models.ts`         | The price table has the cache read and write prices, and functions that price a call's tokens by kind.                                                                                                                       |
| `src/lib/usage/`               | The limits and their decision (`limits.ts`), the store interface and its Postgres implementation, the guard that applies the limits and records the usage, and the one place that builds it with the environment's settings. |
| `src/lib/visitor.ts`           | The visitor id and its cookie.                                                                                                                                                                                               |
| `src/db/schema.ts`, `drizzle/` | The `usage_events` table and its migration (section 9).                                                                                                                                                                      |
| `src/lib/env.ts`               | Two optional settings, `RATE_LIMIT_PER_MINUTE` and `DAILY_TOKEN_BUDGET`.                                                                                                                                                     |

**Tooling**

| Item                                              | What it is                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evals/cost-report.ts` (`pnpm cost:report`)       | The cost report (section 8). Its options choose the project, a period (the last hours or exact dates), the labels to filter by, the use assumed for the projection, and the output format. |
| `src/lib/cost-metrics.ts`, `langsmith-runs.ts`    | The arithmetic of the report, and the code that reads runs back from LangSmith and maps them. Separate, so the arithmetic is tested without a network.                                     |
| `scripts/measure-chat.ts` (changed)               | Sends the session cookie of the world that its question is about, so that the question is a real lookup.                                                                                   |
| `scripts/measure-agent.ts` (changed)              | Labels and flushes its traces. Its cost now credits cached tokens.                                                                                                                         |
| `.claude/commands/cost-check.md`, `settings.json` | A command that reconciles the cost of the traces with the Anthropic Console, and an allowlist for the safe commands (`pnpm test`, `lint`, `typecheck`, `format:check`, `cost:report`).     |
| `langsmith` 0.10.11                               | The tracing SDK, now a direct dependency with an exact version; it was already installed as a dependency of LangChain.                                                                     |

**Documenting**

| Item                        | What it is                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| `README.md`, `.env.example` | The tracing and limit variables, and the two new commands.           |
| `docs/METRICS.md`           | Not changed by this report. Day 5's measurements are recorded there. |

## 4. By environment

| Environment | Traces                                                             | Cache                                                                                   | Usage table and limits                                                                          | Secrets and settings                                                                    |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Dev**     | `loreweaver-dev`, labeled `env` = `development`. Scripts too.      | Does nothing: the dev model, Haiku 4.5, has a minimum cacheable prompt that is too long | Docker Postgres. Run `pnpm --filter web db:migrate` once.                                       | `apps/web/.env.local`: the five `LANGSMITH_*` variables and, optionally, the two limits |
| **Preview** | `loreweaver-dev`, labeled `env` = `preview`, with the dev key      | On: Sonnet 5.5 drafts, and its minimum is shorter than the cached prefix                | Supabase. **The migration must be applied to it before this code runs** (it fails open if not). | Vercel Preview: the dev key, project `loreweaver-dev` and the EU endpoint               |
| **Prod**    | `loreweaver-prod`, labeled `env` = `production`, with the prod key | On, as in Preview                                                                       | The same Supabase project as Preview (as on Day 3): one table, one migration.                   | Vercel Production: the prod key, project `loreweaver-prod` and the EU endpoint          |

The two limit settings are optional in every environment. Their defaults apply when they are not set.

## 5. Routing

Same URLs as Day 4. One changes.

| URL              | File (`apps/web/src/app/`) | Purpose                                                                                                                                                                    |
| ---------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/chat` | `api/chat/route.ts`        | **Changed:** gives a new visitor a cookie, answers `429` with a message and a `Retry-After` header when a limit is reached, and records the usage of the requests it runs. |

All the other URLs are as in the Day 4 report.

## 6. Unit tests and CI

**382 tests** (88 new today), Vitest. Ten of them need a database and are skipped on a laptop without one; they run in CI, and also locally when `TEST_DATABASE_URL` points at the Docker database. None calls a real model.

| Area                    | What is checked                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The limits**          | The rate limit lets the allowed number through, refuses the next request and says how long to wait (never less than a second); the daily budget refuses once spent, counts the cached tokens, starts again at midnight UTC and is checked first; each visitor is counted apart.  |
| **The guard**           | Both limits through a store in memory; a failing store lets the request through and is logged; a failing record never throws; a run's tokens become a row with each model priced by its own prices.                                                                              |
| **The usage store**     | On a **real Postgres**: a request counts when it starts, every kind of token counts, visitors are apart, old requests and yesterday's tokens are left out. This test found a bug that the in-memory tests could not (a date passed to a raw query was refused by the driver).    |
| **The route**           | The usage of a request is recorded; the third request over a limit of two gets a `429` with a message, the header and no model call; a spent budget; separate visitors; a cookie for a new visitor only; a failed run is recorded as failed; an invalid request is not recorded. |
| **The visitor**         | The cookie is read and validated (a malformed value is not trusted), a new id is random, and the cookie is HttpOnly and Secure when deployed.                                                                                                                                    |
| **The tokens**          | The cached tokens are read from a reply, added up and priced at their own prices, and taken out of the input, which includes them.                                                                                                                                               |
| **Tracing and caching** | Every run of a trace (the graph, its nodes, the model calls and the tools) carries the three labels. The system prompt carries the cache marker on a call with tools and does not on the last call.                                                                              |
| **The report**          | Pricing by model and by kind of token with hand-worked numbers, traces left out and counted, the shares, the hit rate, the projection, and the mapping of runs read from LangSmith.                                                                                              |
| **Settings**            | The two limit variables: defaults, valid values, and values that are refused.                                                                                                                                                                                                    |

**CI** is unchanged: format, lint, typecheck, a throw-away Postgres with the migrations (the new one included) and the tests. It does not run `next build`; the Vercel preview does.

## 7. Tracing

**What is sent.** With `LANGSMITH_TRACING=true` and a key, LangChain sends a trace of each agent run: a tree with the graph at the root, then each node, and inside them each model call and tool call, with inputs, outputs, tokens and times. With the setting off, nothing is sent.

**Labels.** The root run carries `env` (`development`, `preview` or `production`), `model` (the drafting model) and `prompt_version`, and every run below it inherits them. They are what a report or a dashboard filters by. LangSmith also records the world and the start time from the run's configuration.

**Which project.** Development, scripts and Preview write to `loreweaver-dev` with the dev key. Production writes to `loreweaver-prod` with the prod key. The key does not choose the project; `LANGSMITH_PROJECT` does. The workspace is in the EU region, so every environment sets the EU API address, and a key that covers the organization also needs the workspace id.

**Sending after the response.** Traces are sent in the background, and a serverless function can be stopped when its response ends. The chat route therefore waits for the pending uploads after the response (so the answer is not delayed), with `after()`.

**What a trace contains.** The author's question, the lore passages the search returned, the character's state and the answer. Traces are kept by LangSmith for a limited time on the plan in use.

## 8. Cost accounting

**The formula.** For one question, the sum over its model calls of: input tokens (those that were not cached) at the input price, cached tokens at the cache-read price, tokens written to the cache at the cache-write price, and output tokens at the output price. Prices are in `src/lib/ai/models.ts`, with the date they were read from the provider's pricing page. The embedding of the search question costs a negligible amount and is not in the traces.

**The report.** `pnpm cost:report` reads the runs of a project for a period, keeps the traces whose labels match the options, prices every model call by the model that really made it (the checker's calls carry the drafting model's label, so the label would price them wrongly), and prints per question the tokens by type, the cost and the latency, then the mean, median and p95, the share of the cost by kind of token and by node, the cache hit rate, and a monthly projection. It also compares its total with the cost LangSmith computes for the same calls. It sends nothing to a model.

**Caching.** The prefix of a request is built in the order tools, system prompt, messages. One marker at the end of the system prompt caches the tool definitions and the prompt together, and everything that changes comes after it. It applies to the drafting calls that offer the tools. The last call of a draft has no tools and a note added to its prompt, so it does not start like the others and would only pay the write premium; it is left out. The checker's prompt is below the minimum of its model and is not cached.

**`/cost-check`.** A Claude Code command that runs the report for a period, asks the developer for the same period's figures from the Anthropic Console, and compares them by model, with a list of usual causes of a difference.

## 9. Consumption limits

**Who is a visitor.** There is no sign-in. The server gives each browser a random id in a cookie that only the server can read (`lw_visitor`, a year), the same way it keeps the world. It is not an account: clearing the cookies gives a new id and a new allowance.

**The table `usage_events`.** One row per chat request: visitor id, world, drafting model, prompt version, status (`started`, `completed` or `failed`), tokens in four non-overlapping columns (uncached input, cache read, cache write, output), cost, latency and time. The row is inserted when the request starts and updated when it ends, so a running request counts toward the rate limit. Only ids and counts are stored, never text. Row Level Security is on with no policies, as for the other tables.

**The limits.** Both are checked in the route, after the request is validated and before any model is called.

| Limit                  | Rule                                                                                                                                                 | Default        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Rate limit**         | The number of requests the visitor started in the last 60 seconds must be below the limit. The answer says how many seconds to wait.                 | 10 a minute    |
| **Daily token budget** | The tokens of all kinds and all model calls of the visitor since midnight UTC must be below the budget. The answer says it starts again at midnight. | 200,000 tokens |

The daily budget is checked first, because waiting a minute does not help once it is spent. A refused request answers `429` with a JSON body (`error`, a plain-language `message` and `retryAfterSeconds`) and a `Retry-After` header, and is not recorded, so asking again does not lengthen the wait. The chat shows the message as it is.

**When the database fails.** The request is let through and the failure is logged: a chat that stops because of its own bookkeeping is worse for a product at this stage than a few unmetered answers. The limits do not hold during such an outage.

## 10. Additional items and known limits

**Additional items**

- The first live run of the timing script printed ten successes that were all refusals: its question names a character of the second world, and the script sent no world cookie. The script now sends one.
- The cost report was given exact periods (`--from`, `--to`), so a report can be repeated for the same runs later.
- The real-database test of the usage store found that a date inside a raw query fragment is refused by the database driver. Without that test the limits would have failed open on every request.
- The agent's token counts now include cached tokens, so the cost of a run in the measuring script is correct with caching on.

**Known limits**

- **A visitor is a cookie.** Clearing it resets the limits, and a script that sends no cookie gets a new visitor for every request. The limits stop a runaway tab or client, not a determined abuser; that needs sign-in.
- **Parallel requests can slip past the budget.** A request's tokens count when it ends, so requests that run at the same time are each checked against the tokens of the finished ones.
- **Failing open** means that during a database outage, the limits are off.
- **Caching only helps Sonnet 5.5.** On a developer's machine (Haiku 4.5) the prompt is below its minimum and nothing is cached, and the checker's prompt never is. The cache lives five minutes, so with one question every few minutes most calls pay the write.
- **Tool calls run one after the other, on purpose**: the agent's prompt tells the model to fetch the character first and then search the lore with what it learned. Running them together would be faster and would change how the model works.
- **Prices are copied into the code** with their date. When a provider changes a price, `models.ts` must change with it; the reconciliation with the Anthropic Console is how a stale price is noticed.
- **Traces hold the authors' text.** Which of it is sent, who can read it and for how long is not yet written down or restricted beyond the separate projects and keys.
- **Traces of scripts and Preview share one project** with those of the laptop; the labels tell them apart, and a report needs an exact period to exclude test runs.
- **The thumbs up and down of the chat are not linked to the trace** of the answer they rate.
- **The usage table grows without cleanup.** Rows are small, and nothing deletes the old ones.
