# Day 2 report: Model layer, streaming and Generative UI

## 1. Summary

Day 2 gave Loreweaver its first AI features:

- A **streaming chat** in the browser, backed by a server route that calls Claude.
- A **first tool** that reads live character state from the legacy CMS, shown as a **Character Status Card**.
- A **model choice made from evidence**: a small benchmark, recorded in ADR-0002.
- **Feedback buttons** that store events in Postgres, an **AI-generated label**, and a **versioned system prompt**.

The model never invents character state: it asks the tool, and the card shows the CMS data as received.

## 2. Learn, Prepare and Build

| Section                      | What was done                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                    | How inference feels to users (prefill and decode, TTFT), streaming (SSE and the AI SDK message stream), tool calling, Generative UI, model selection, sampling, prompt basics. Plus React, Next.js and chat UIs. |
| **Prepare**                  | Anthropic Console (prepaid credits, spend limit, `dev` and `prod` keys). Supabase project in `eu-west-1` and Vercel variables. A Postgres container in Docker Compose. AI SDK, Drizzle and shadcn/ui installed.  |
| **Build**                    | Four parts: the chat, the model choice, the first tool with its cards, and the product details around them.                                                                                                      |
| **Build A: Chat**            | Streaming chat page and `POST /api/chat` route (validation, error masking, stop and regenerate).                                                                                                                 |
| **Build B: Model choice**    | A five-prompt benchmark of two models, and ADR-0002: Haiku 4.5 in development, Sonnet 5.5 in Preview and Production.                                                                                             |
| **Build C: Tool and cards**  | The `fetch_character_state` tool, and the Character Status Card with loading, loaded and error states.                                                                                                           |
| **Build D: Product details** | Feedback capture in Postgres, the AI-generated label, and the system prompt moved to a versioned file.                                                                                                           |

## 3. By area

| Area            | Most important things added or used                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | `ChatPanel` (`useChat`, status handling, sticky auto-scroll), `MessageActions` (feedback), `CharacterStatusCard` with its skeleton and error versions, an AI-generated badge. Components come from shadcn/ui (Button, Textarea, Card, Badge, Skeleton), styled with Tailwind. Message parts are typed from the tool definition, so `part.output` is checked by TypeScript.                                                                                                                           |
| **Backend**     | `/api/chat`: validates the request (1 to 30 messages, 40,000 characters), calls `streamText` with the tool (up to 3 steps), hides provider errors, stops the model call when the user presses Stop. `src/lib/ai/models.ts`: one place for models, prices and the per-environment default. `src/lib/ai/tools.ts`: the tool. `/api/feedback` and `src/db/` (Drizzle client and schema). `src/lib/prompts/`: loads the versioned prompt. Env loader also checks `ANTHROPIC_API_KEY` and `DATABASE_URL`. |
| **Tooling**     | AI SDK 7.0.136 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`), Drizzle ORM and Drizzle Kit (migrations), `postgres` driver, shadcn CLI, Postgres (pgvector image) in Docker Compose, `pnpm benchmark`, `pnpm db:generate` and `pnpm db:migrate`, `outputFileTracingIncludes` so the prompt file is deployed, `.prettierignore` for prompt files.                                                                                                                                                       |
| **Documenting** | ADR-0002 (model choice), `docs/BENCHMARK.md` (full benchmark record), `src/lib/prompts/agent.v1.md` (the prompt, as a reviewed file), and this report.                                                                                                                                                                                                                                                                                                                                               |

## 4. By environment

| Environment | Web app and model                                                        | Database                                            | CMS                    | Secrets                                               |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| **Dev**     | `pnpm dev`. Haiku 4.5 by default. The benchmark may choose either model. | Docker Postgres (`pgvector/pgvector:pg17`) on :5432 | Docker, localhost:8080 | `apps/web/.env.local` (dev key, local `DATABASE_URL`) |
| **Preview** | One Vercel URL per pull request. Sonnet 5.5, not changeable by callers.  | Supabase (pooled connection)                        | Cloud Run              | Vercel Preview variables (dev key)                    |
| **Prod**    | Vercel, from `main`. Sonnet 5.5, not changeable by callers.              | The same Supabase project as Preview                | Cloud Run              | Vercel Production variables (prod key)                |

The model is picked from `VERCEL_ENV` (`preview`, `production`, or unset locally). The same migration is applied to the Docker and Supabase databases.

## 5. Routing

Next.js App Router: the **folder path is the URL**. `page.tsx` makes a screen for browsers, `route.ts` makes an endpoint for code.

| URL                               | File                                          | Kind     | Purpose                                                              |
| --------------------------------- | --------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `/`                               | `src/app/(chat)/page.tsx`                     | Page     | The chat. `(chat)` is only a folder name and adds nothing to the URL |
| `POST /api/chat`                  | `src/app/api/chat/route.ts`                   | Endpoint | Streams the model's answer and tool results                          |
| `POST /api/feedback`              | `src/app/api/feedback/route.ts`               | Endpoint | Stores one feedback event                                            |
| `GET /api/health`                 | `src/app/api/health/route.ts`                 | Endpoint | Liveness (Day 1)                                                     |
| `GET /api/legacy/character-state` | `src/app/api/legacy/character-state/route.ts` | Endpoint | Quick development fallback (Day 1)                                   |

Both kinds run on the same Node server (serverless functions on Vercel). The page is a Server Component; only `ChatPanel` and `MessageActions` run in the browser (`"use client"`).

## 6. Unit tests and CI

**74 unit tests** (32 new today), Vitest, no network, database or API key needed:

| Area           | What is checked                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model choice   | Haiku locally, Sonnet in Preview and Prod; an allowlisted override works only locally; prices are computed correctly.                                   |
| Chat request   | Valid requests pass; empty, too many or oversized messages are rejected.                                                                                |
| Tool           | With a fake CMS client: success, error passed through as data, and a non-numeric id rejected without calling the CMS.                                   |
| Card helpers   | Bar width is clamped, an unknown location is never guessed, dates are formatted in UTC, error text never leaks internals.                               |
| Feedback       | Only `up`, `down`, `copy` are accepted; model and prompt labels from the browser are kept only if recognized.                                           |
| Prompt and env | The prompt keeps its key rules (use the tool, never guess, admit what is unknown); the env loader names every missing variable, including the new ones. |

**CI** is unchanged: on every pull request and push to `main` it runs `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck` and `test`. It does **not** run `next build`. The Vercel preview build did, and caught a real error (a random chat id being prerendered), which is now fixed.

## 7. The model benchmark

Five Loreweaver-style prompts (ideas, a rule check, an honesty test, a format test, short prose) were sent to both models through the real chat route, and each answer was scored for quality. The legacy CMS was not involved. The full method, the prompts, the scores and the answers are in `docs/BENCHMARK.md`.

**Result:** Sonnet is better mainly at following instructions; both refused to invent a name. Sonnet is slower to start and costs more per answer. **ADR-0002** therefore uses Sonnet for Preview and Prod and Haiku for development, with a revisit trigger: p95 above 8 s or cost per query above $0.05. The thin evidence (5 prompts, 1 run, one scorer, no tools) is stated in the ADR.

## 8. The tool and how it appears in the UI

**`fetch_character_state`** (`src/lib/ai/tools.ts`) lets the model ask for one character's live state, so it never answers from memory.

| Part         | Detail                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input        | `{ character_id: string }`, validated with Zod. The model chooses it, so the server also checks it is numeric.                                            |
| Work         | Calls the Day 1 legacy client (timeout, retries, circuit breaker, Zod mapping), which returns a clean `CharacterState`.                                   |
| Output       | Data, not exceptions: `{ ok: true, character }` or `{ ok: false, error }`. Errors carry `stale: true` when the CMS is unavailable.                        |
| Two readers  | The model gets the result to write a short answer (a second model step). The browser gets it to draw the card.                                            |
| Prompt rules | Always use the tool for live state; do not repeat the card's values; if unavailable, say so briefly and do not guess. A temporary list maps names to ids. |

**How it appears.** The streamed message has a part named `tool-fetch_character_state` with a state. The chat shows a component for each state:

| Tool state                                      | What the user sees                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Starting (`input-streaming`, `input-available`) | A **loading skeleton**: gray placeholder with the card's layout, shown before the CMS answers |
| Result with `ok: true`                          | The **Character Status Card**                                                                 |
| Result with `ok: false`, or tool error          | An **error card**: "Character service unavailable", saying earlier data may be out of date    |

**Character Status Card** is a small card inside the chat, drawn from the tool result and not from the model's words, so the numbers are exact. It shows:

- the **name** and a **condition badge** (healthy, or wounded in red);
- the **location** name (an unknown code is shown as such, never guessed);
- a **mana bar** and a **health bar** with their values (scale 0 to 100, an assumption from the seed data);
- the **inventory** as chips, or "Carrying nothing.";
- **"Updated … UTC"**, so the author sees how fresh the data is.

## 9. What the UI can do

| Capability        | Detail                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat              | Send with Enter (Shift+Enter adds a line). Replies stream in live. "Thinking…" before the first token.                                     |
| Control           | **Stop** cancels the reply and the model call. **Regenerate** redoes the last answer. **Retry** appears after an error.                    |
| Reading           | The view follows new text, but only while you are at the bottom. Plain text: Markdown is not rendered.                                     |
| Rich results      | Character Status Card with skeleton and error states.                                                                                      |
| Feedback          | Thumbs up, thumbs down and copy under each finished answer. The button reacts at once; a failed save shows a message.                      |
| Transparency      | An "AI-generated suggestions" badge in the header and a reminder under the input.                                                          |
| Accessibility     | The message list is a live region; bars have progressbar roles; skeleton and error cards have status and alert roles; buttons have labels. |
| Not available yet | Chat history across reloads (it lives in the browser's memory), login, several conversations.                                              |

## 10. What is stored in the database

**Postgres** (Docker locally, Supabase in Preview and Prod) holds one table, `feedback_events`, an **append-only log**: each click adds a row and rows are never changed, so a change of mind (up, then down) keeps both events.

| Column           | Type                 | Meaning                                                                                      |
| ---------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `id`             | uuid (primary key)   | Generated by the database                                                                    |
| `chat_id`        | text                 | A random id made in the browser for each chat session (there is no login, so no user id yet) |
| `message_id`     | text                 | The assistant message that was rated or copied (indexed)                                     |
| `kind`           | enum `feedback_kind` | `up`, `down` or `copy`                                                                       |
| `model_id`       | text, optional       | Which model wrote the message (only allowlisted values are kept)                             |
| `prompt_version` | text, optional       | Which prompt version was used, for example `agent.v1`                                        |
| `created_at`     | timestamptz          | Set by the database                                                                          |

**Not stored:** message text, user identity, character data. The table is created by the migration `apps/web/drizzle/0000_*.sql`, generated from `src/db/schema.ts` with Drizzle Kit. `0001_*.sql` switches on **Row Level Security** (no policies): Supabase exposes public tables through its own web API, and RLS closes that door; the app connects as the database owner, which bypasses RLS. Migrations are applied by hand with `pnpm db:migrate` and the target's connection string (not part of the deploy). Character state stays in the legacy CMS's own SQLite database (see the Day 1 report). Day 3 will add vectors in the same Postgres (pgvector).

## 11. Additional items and known limits

**Additional items**

- Request guards on `/api/chat`: size limits, generic user-facing errors, a 30 s limit, and the model override restricted to an allowlist and to local machines.
- Per-environment default model, and `promptVersion` and `modelId` attached to each answer and sent back with feedback.
- `docs/BENCHMARK.md` and `pnpm benchmark`.
- `useId()` as the chat id, so the page can be prerendered (found by the Vercel build).
- Typed tool parts shared between server and browser (type-only import).
- Plain-text and short-reply rules in the prompt, after seeing raw Markdown and repeated text in the UI.
- Row Level Security on `feedback_events`, after Supabase's Security Advisor flagged it.
- A random chat id per session for feedback (React's `useId()` gave every visitor the same value).
- Not built: a fallback model for when the provider fails, and counting tokens before sending.

**Known limits**

- `/api/chat` and `/api/feedback` have no login or rate limit. The $20 Anthropic spend limit is the safety net.
- Chat history is kept only in the browser and is sent by the browser on each message, so it can be forged (the tool re-reads facts each turn).
- The name-to-id list is in the prompt and can drift from the CMS; the tool does not check the world.
- Preview and Prod share one Supabase project, so their feedback mixes.
- The 8 s latency budget is unproven for a full agent answer on Sonnet.
- Benchmark evidence is thin (see section 7).
