# Day 3 report: Lore, embeddings and retrieval

## 1. Summary

Day 3 gave Loreweaver knowledge of the author's world, and the means to search it:

- A **Lore Bible** (two worlds, as Markdown files) and **`pnpm ingest`**, which turns it into searchable vectors in Postgres.
- A **`search_lore` tool** that returns the passages that answer a question, with citation ids, limited to the visitor's world by the server.
- **Lore Citation cards** that show each cited passage in the chat.
- A **world per request**, decided by the server and applied to lore search, character lookup and the system prompt.
- A **labeled question set** and a command that scores the search without any model, and **ADR-0003**.

The assistant answers lore questions only from the passages it retrieves, and cites them.

## 2. Learn, Prepare and Build

| Section                         | What was done                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Learn**                       | Embeddings and similarity, chunking, metadata and tenant isolation, exact and approximate vector search, hybrid search, reranking, retrieval metrics. Also what lore, canon, character state and manuscript mean in this product, and what each data store holds.  |
| **Prepare**                     | Voyage AI account and keys (`dev` and `prod`) with the Vercel variables. The `vector` extension in Docker and Supabase, as a migration. The `data/lore/` and `evals/` folders and the Markdown packages. A real Voyage call to check the vector size (section 11). |
| **Build**                       | Four parts: the lore and its ingestion, the search tool with its cards, the separation of worlds, and the retrieval eval.                                                                                                                                          |
| **Build A: Lore and ingestion** | The Lore Bible (6 files for Aethel, 3 for Nox) and `pnpm ingest`: cut at headings, embed, write to Postgres, safe to run again.                                                                                                                                    |
| **Build B: Search and cards**   | The `search_lore` tool, a second system prompt version that tells the model how to use and cite it, and the Lore Citation cards.                                                                                                                                   |
| **Build C: World separation**   | A server-side world for each request, a world selector, the world limit on lore search, the character tool, the prompt and the fallback route, and a test against a real database, with a database in CI.                                                          |
| **Build D: Retrieval eval**     | A labeled question set, the scoring code and `pnpm eval:retrieval`; ADR-0003.                                                                                                                                                                                      |

## 3. By area

**Frontend**

| Item                  | What it is                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LoreCitationCards`   | One collapsible card per passage, built on a native `details` element, with loading, empty and error versions. Passage text is rendered as text, never as HTML. |
| `WorldSwitcher`       | A header dropdown. It asks the server to remember the world, tells the page which one it is, and clears the chat on a change.                                   |
| `ChatPanel` (changed) | Maps the `tool-search_lore` message part to the cards, and shows example questions that fit the selected world.                                                 |

**Backend**

| Item                              | What it is                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/rag/` ingestion modules  | `chunking.ts` (cut at headings, then by size, with overlap), `lore-files.ts` (front matter, line endings), `ingest-plan.ts` (what to keep, copy, embed or remove).                                      |
| `src/lib/rag/embeddings.ts`       | The Voyage client: batches, retries with backoff, vector size checks, token and cost reporting.                                                                                                         |
| `src/lib/rag/search.ts`           | The search: embed the question, one SQL query for the nearest chunks of the world, a similarity floor, citation ids. Failures are returned as data.                                                     |
| `src/lib/ai/tools.ts`             | Tools are built for each request with the world inside them: `search_lore` (new) and `fetch_character_state` (now world-limited).                                                                       |
| `src/lib/session.ts`, `worlds.ts` | The world of a request, read from an HttpOnly cookie and checked against the known worlds, and each world's characters and example questions. Route `/api/session/world`.                               |
| `lore_chunks` and its migrations  | `0002` enables the pgvector extension, `0003` creates the table (section 9).                                                                                                                            |
| `src/lib/prompts/agent.v2.md`     | A prompt template: use and cite the lore search, say when the lore does not cover a question, treat passages as data, read character state before searching. The character list is filled in per world. |
| `src/lib/env.ts`                  | Adds `VOYAGE_API_KEY` and `EMBEDDING_MODEL`, and a smaller schema for scripts.                                                                                                                          |

**Tooling**

| Item                                              | What it is                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm ingest`, `pnpm eval:retrieval`              | The two commands of the day (sections 10 and 13). `ingest` has `--world`, `--config` and `--dry-run`.                         |
| `unified`, `remark-parse`, `mdast-util-to-string` | A Markdown parser, so headings are found properly (a `#` in a code block is not a heading).                                   |
| CI database                                       | CI starts a throw-away Postgres with pgvector and applies the migrations to it, so the isolation test runs there (section 6). |
| Root `zod` and `vitest`                           | Let the root `evals/` folder resolve its packages. `evals/` is also part of the type-check and the test run.                  |
| `src/db/standalone.ts`                            | A database client for scripts, which need only a connection string.                                                           |

**Documenting**

| Item                                     | What it is                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The Lore Bible and `data/lore/README.md` | The lore itself, and the format of the files (section 13).                                                                        |
| ADR-0003                                 | Chunking, embeddings, storage and search, and world isolation: options, decision, consequences, follow-ups.                       |
| `evals/README.md`                        | The question set format and the scoring rules.                                                                                    |
| PRD and README                           | The PRD says the manuscript is out of scope. The README has new sections: lore and ingestion, searching the lore, database tests. |

## 4. By environment

| Environment | App and model                                                              | Database                                                             | Lore and embeddings                                                     | Secrets                                                        |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Dev**     | `pnpm dev`. Haiku 4.5. The world cookie works over plain `http`.           | Docker Postgres with pgvector. Migrations applied with `db:migrate`. | `pnpm ingest` writes to the local table. Voyage `voyage-4-lite`.        | `apps/web/.env.local`, with the new Voyage key and model name. |
| **Preview** | One Vercel URL per pull request. Sonnet 5.5. The world cookie is `Secure`. | Supabase, with the `vector` extension and the `lore_chunks` table.   | Loaded into Supabase by hand: `pnpm ingest` with its connection string. | Vercel Preview variables (`dev` key).                          |
| **Prod**    | Vercel, from `main`. Sonnet 5.5.                                           | The same Supabase project as Preview, so the same lore.              | The same rows as Preview.                                               | Vercel Production variables (`prod` key).                      |

Migrations are also applied to Supabase by hand. The app refuses to start if the Voyage variables are missing.

## 5. Routing

The folder path is the URL: `page.tsx` makes a screen for browsers, `route.ts` makes an endpoint for code.

| URL                               | File                                          | Purpose                                                                                   |
| --------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                               | `src/app/(chat)/page.tsx`                     | The chat page, with the world selector                                                    |
| `POST /api/chat`                  | `src/app/api/chat/route.ts`                   | Streams answers. Reads the world from the session and builds the tools and prompt with it |
| `GET`, `POST /api/session/world`  | `src/app/api/session/world/route.ts`          | Read the world and the list of worlds. Remember a known world (400 for an unknown one)    |
| `POST /api/feedback`              | `src/app/api/feedback/route.ts`               | Stores one feedback event (Day 2)                                                         |
| `GET /api/health`                 | `src/app/api/health/route.ts`                 | Liveness (Day 1)                                                                          |
| `GET /api/legacy/character-state` | `src/app/api/legacy/character-state/route.ts` | Development fallback (Day 1), now limited to the visitor's world                          |

The model never calls an endpoint for lore: `search_lore` runs inside `/api/chat`, on the server.

## 6. Unit tests and CI

**193 tests** (119 new today), Vitest. Almost all need no network, database or key.

| Area                  | What is checked                                                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Isolation**         | **Against a real Postgres:** a query in one world never returns another world's chunks, even when they are the closest vectors, in both directions, for a world with no lore, and through the whole search. Removing the world filter on purpose made it fail. |
| Tools and session     | The search tool's schema has no world field, and a world sent by the model is dropped. Another world's character gives exactly the answer of a missing one. Only known worlds are accepted from the cookie.                                                    |
| Chunking and ingest   | Heading paths nest, no chunk exceeds the cap, no sentence is lost. A second ingest writes nothing, an edit re-embeds only that chunk, a model change re-embeds all, a deleted file removes its rows.                                                           |
| Voyage client         | Batches keep their order. 429 and 5xx are retried with backoff. A wrong key is not retried and never appears in an error. A wrong vector size is rejected.                                                                                                     |
| Lore and question set | Windows and Unix line endings give the same result. The real Lore Bible and question set are valid, and every label points at a section that exists. The scoring code matches numbers worked out by hand.                                                      |
| UI and prompt         | Cards are collapsed by default, text is escaped, empty, loading and error states render. The prompt lists only the characters of the visitor's world.                                                                                                          |

**CI** runs on every pull request and push to `main`: `format:check`, `lint`, `typecheck`, then it starts a throw-away Postgres with pgvector, applies the migrations to it (which proves they run on an empty database) and runs the tests, including the isolation test. If the database setting is missing, a guard test fails, so the isolation test cannot be skipped silently. CI does not run `next build`; the Vercel preview does.

## 7. The tools and how they appear in the UI

| Tool                    | What it does                                                                                                | Input                           | Output                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **`search_lore`** (new) | Finds the passages of the author's lore that answer a question: for rules, places, history and backstories. | `{ query, k? }`, no world field | `{ ok: true, hits }` (id, file, heading path, kind, text), or `{ ok: false, error }`. Top 3 by default, at most 8. |
| `fetch_character_state` | Live state of one character from the CMS (Day 2), now limited to the visitor's world (section 12).          | `{ character_id }`              | `{ ok: true, character }` or `{ ok: false, error }`                                                                |

**How a lore question runs.** The model calls `search_lore`. The tool embeds the question, runs one SQL query for the nearest chunks of the visitor's world, and drops passages below a cosine similarity of 0.30 (provisional), so an off-topic question returns nothing. The model answers from the passages and cites them as `[id]`; if two passages disagree it says so; for a question that needs a character's state, it reads the state first and searches with what it learned.

**New card: the Lore Citation card.** The Character Status Card remains for character state; lore results appear as a second kind of card.

| Tool state                                      | What the user sees                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Starting (`input-streaming`, `input-available`) | A gray **skeleton** card                                           |
| Result with passages                            | "N sources from your lore", then one **card per passage**          |
| Result without passages                         | A "No matching lore" card                                          |
| Tool failure                                    | An error card ("Lore search unavailable"). The chat keeps working. |

Each card shows the **heading path** (for example `The Magic of Aethel > Casting Rules > Teleportation`), the **file name and kind** (Rule, Location, History, Character), a **citation id badge** that matches the `[id]` in the answer, and a **snippet**. Clicking it opens the **full passage**.

## 8. What the current UI can do

| Capability        | Detail                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat              | Send with Enter (Shift+Enter adds a line). Replies stream in live, in plain text. "Thinking…" before the first token.                           |
| Control           | **Stop** cancels the reply and the model call. **Regenerate** redoes the last answer. **Retry** appears after an error.                         |
| World             | A selector in the header. Changing it starts a new conversation. The example questions in the empty chat fit the selected world.                |
| Character state   | The Character Status Card: name, condition, location, mana and health bars, inventory, update time, with skeleton and error states.             |
| Lore sources      | The Lore Citation cards (section 7). Answers carry `[id]` citations, and say when passages disagree or when the lore does not cover a question. |
| Feedback          | Thumbs up, thumbs down and copy under each finished answer, stored in Postgres.                                                                 |
| Transparency      | An "AI-generated suggestions" badge and a reminder under the input.                                                                             |
| Accessibility     | The message list is a live region. Bars have progressbar roles, skeletons status roles, error cards alert roles. Cards open with the keyboard.  |
| Not available yet | Sign-in, chat history across reloads, uploading or editing lore, showing which sentence of a passage supports which claim.                      |

## 9. What the vector database stores, and why it is not the CMS

**The vector database holds the world's lore as text. The legacy CMS holds the live state of characters. Nothing joins them in the database: the agent combines them at question time, through the two tools, tied by `world_id`.**

|                 | Legacy CMS                                                  | Vector database (`lore_chunks`)                                     |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Holds           | Live state of characters: location, inventory, mana, health | The lore: rules, places, history, backstories, as chunks of text    |
| Changes         | Often                                                       | Rarely                                                              |
| Asked by        | Id (exact lookup)                                           | Meaning (similarity search)                                         |
| Source of truth | Yes, for state                                              | No: an index that `pnpm ingest` can rebuild from the Markdown files |

**One row per chunk:** `world_id` (the tenant), `chunking` (the configuration that made it), `source_path` and `chunk_index`, `doc_type`, `heading_path`, `content` (the text the model reads), `embedding` (`vector(1024)`, the search key), `embedding_model`, `content_hash`, `token_estimate`. The text is stored with the vector because a vector cannot be turned back into text. Not stored: character state, chat messages, feedback (its own table), the manuscript, secrets.

**Choices made**

| Choice        | Decision                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where         | **Postgres with pgvector**, in Docker and Supabase: vectors, labels and the world filter in the database the app already has. Not in memory (tests only), not a separate vector service. |
| How to search | **Exact scan, no index.** At hundreds of rows it is exact and fast. An approximate index (HNSW or IVF) comes when size or time demands it.                                               |
| Distance      | Cosine (`<=>`). The vectors are normalized, so it ranks like a dot product.                                                                                                              |
| Embeddings    | Voyage `voyage-4-lite`, 1024 dimensions. The same model embeds chunks and questions.                                                                                                     |
| Chunking      | Cut at headings, size cap and overlap, heading path in front of the embedded text. Two named configurations are stored side by side.                                                     |
| Safety        | Row Level Security on, with no policies, like `feedback_events`.                                                                                                                         |

## 10. Ingestion

`pnpm ingest` (options `--world`, `--config`, `--dry-run`) turns `data/lore/` into rows:

1. **Read** each file: the `doc_type` from its front matter, line endings normalized.
2. **Cut** it at its headings, then by paragraph, sentence and word if a section is over the cap, with a small overlap that never crosses a heading.
3. **Hash** each chunk: the model name plus the exact text that is embedded.
4. **Compare** with the stored rows and sort each chunk: unchanged chunks are kept, a chunk that only moved reuses its vector, new text is embedded (once, even if repeated), rows with no chunk any more are removed.
5. **Embed** only what is new, in batches, with retries.
6. **Write** deletes and inserts in one transaction.

Running it again on unchanged lore embeds nothing. Changing the model changes every hash, so everything is embedded again. It prints the tokens sent and their cost at list price. It writes to the database in `DATABASE_URL`; Supabase is filled by running it with its connection string.

## 11. Testing Voyage AI: vector size and normalization

Voyage's pages do not state whether its vectors are normalized, and the dashboard does not show it, so a real call tested it (two lore sentences as documents, one question as a query, `voyage-4-lite`):

- The key is accepted, and token usage is reported with each response (used for the ingestion cost).
- **1024 dimensions**, the model's default size. Every request sends `output_dimension` 1024, and every returned vector's length is checked against the column.
- **Every vector has length 1.000000**: they are normalized, so cosine similarity and dot product rank identically.
- A question was closer to the sentence it matched than to an unrelated one.

## 12. World isolation

> **Never trust a world ID supplied by the LLM. Take it from the session.**

| Layer              | What it does                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| The model's tool   | `search_lore` has no world field. If the model sends one, the schema removes it.                                              |
| The server         | The world is read from the session for each request, and the tools and the prompt are built with it. The model cannot see it. |
| The database query | The world is a condition of the SQL `WHERE`, so a chunk of another world is never a candidate, however close its vector is.   |
| The test           | A real-Postgres test proves it (section 6), and CI always runs it.                                                            |

**The world stand-in.** There is no sign-in yet (it comes later), so "the session" is a stand-in: an HttpOnly cookie (`lw_world`) set by the world selector, checked against the known worlds, defaulting to Aethel, and read by one function, `getSessionWorldId`. It is not authentication: any visitor can pick any known world. Compared options: real sign-in now (not yet planned), one fixed world per deployment (nothing to switch between), a signed cookie (adds nothing while anyone can obtain one). The seam means sign-in will replace one function.

**The `fetch_character_state` gap.** The CMS knows every world, and the model chooses the character id, so another world's character could be read. Three places were fixed, all with the session's world:

| Place                                        | Problem                                                | Fix                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `fetch_character_state`                      | An id of another world returned that world's character | Another world's character gives the same answer as a missing one, so it does not reveal that they exist |
| System prompt                                | It named the characters of both worlds                 | A template filled with the visitor's world's characters only                                            |
| Fallback route `/api/legacy/character-state` | Public, returned any character                         | Limited to the visitor's world, with the same 404                                                       |

## 13. The `data` and `evals` folders

| Folder       | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/lore/` | **The source of truth for the lore.** One folder per world, named like the world id the CMS uses (`world_aethel`, `world_nox`); one Markdown file per topic, starting with a `doc_type`. The Aethel files hold testable rules and a few passages that deliberately conflict. The lore says what is always true of a world, never where a character is now. The manuscript is out of scope.                                                                                                                                                                                 |
| `evals/`     | **Measures the search on its own, with no model.** `retrieval.jsonl` has 36 questions, each with the lore **sections** (a file and a heading path) that answer it, graded 2 or 1; four have no answer. Labels name sections, not chunks, because chunk boundaries change with the configuration. `retrieval-metrics.ts` computes hit rate, recall, precision, MRR and nDCG; `pnpm eval:retrieval` runs the real search for any stored configuration. A test fails if a label points at a section that no longer exists. The set was committed before the scoring code ran. |

## 14. Additional items and known limits

**Additional items**

- The example questions in the empty chat follow the selected world (a final touch, after the first deploy suggested a Nox character in the Aethel chat).
- Voyage requests refuse over-long texts instead of truncating them silently.
- Calling the state tool and the lore search at the same time loses the character's place, so the prompt asks for them in order.
- Not built: hybrid search (keywords plus vectors) and a reranker.

**Known limits**

- **No sign-in.** The world cookie is a stand-in, and any visitor can pick any known world.
- **"Extension in Public" warning.** The Supabase Security Advisor reports the `vector` extension in the `public` schema. It stays on purpose, so the local and hosted databases are identical.
- Preview and Production share one Supabase project, so they share the lore, which is loaded by hand.
- The character list per world is written by hand and can drift from the CMS.
- The similarity floor of 0.30 is provisional and belongs to the current embedding model. It cannot tell an unanswerable question that names real things from a real one, so for those the assistant has to notice that the passages do not answer it.
- Search quality depends on the question the model writes, and outdated or misleading passages can rank high.
- The question set was written by one person, is small, and is scored on whole sections.
- Exact search compares the question with every chunk of the world, which has to be revisited for much larger worlds.
- The dev model sometimes announces a tool call in a separate text bubble; the Preview and Production model was not checked for this.
- ESLint does not cover the `evals/` folder (the type-check, tests and Prettier do).
