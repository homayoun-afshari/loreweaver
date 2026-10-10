# Day 3 report: Lore, embeddings and retrieval

**Status:** Build complete (steps 1 to 7). Two optional extras were not built: hybrid search and a reranker.

## 1. Summary

Day 3 gave Loreweaver its knowledge of the author's world:

- A **Lore Bible** of two worlds, written as Markdown files, and an **ingestion command** that turns it into searchable vectors in Postgres. Running it again costs nothing.
- A **`search_lore` tool** that finds the passages that answer a question, with citation ids, **limited to the visitor's world** by the server and never by the model.
- **Lore Citation cards** in the chat, so every cited passage can be opened and checked.
- A **labeled question set and a command** that score the search on its own, before any model writes an answer.
- **ADR-0003**, which records the chunking and retrieval strategy.

The assistant answers lore questions only from retrieved passages and cites them. An off-topic question returns no passages, and when the lore does not answer a question the assistant says so.

## 2. Learn, Prepare and Build

| Section                         | What was done                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                       | Embeddings and similarity, chunking strategies, metadata and tenant isolation, exact and approximate vector search, hybrid search, reranking, retrieval metrics. Plus what lore, canon, state and manuscript mean in this product. |
| **Prepare**                     | Voyage AI account and keys (`dev` and `prod`) and the Vercel variables. The `vector` extension in Docker and Supabase, as a migration. The `data/lore/` and `evals/` folders and the Markdown parsing packages.                    |
| **Build A: Lore and ingestion** | The Lore Bible (6 files for Aethel, 3 for Nox) and `pnpm ingest`: heading-aware chunking, embeddings, an idempotent write to `lore_chunks`.                                                                                        |
| **Build B: Search and cards**   | The `search_lore` tool, the second system prompt version, and the Lore Citation cards with loading, empty and error states.                                                                                                        |
| **Build C: World separation**   | A server-side session for the visitor's world and a world selector, the world limit applied to the lore search, the character tool, the system prompt and the fallback route, and a real-database test with a database in CI.      |
| **Build D: Retrieval eval**     | A labeled question set, the scoring code, `pnpm eval:retrieval`, and ADR-0003.                                                                                                                                                     |

## 3. By area

| Area            | Most important things added or used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | `LoreCitationCards`: one collapsible card per passage (heading, file, kind, citation id, snippet; the full text when opened) built on a native `details` element, with skeleton, "no matching lore" and error states. `WorldSwitcher` in the header. `ChatPanel` maps the `tool-search_lore` part to the cards and clears the chat when the world changes. Passage text is rendered as text, never as HTML.                                                                                                                                                                                                |
| **Backend**     | `src/lib/rag/`: `chunking.ts` (cut at headings, then by size, with overlap), `lore-files.ts` (front matter, line endings), `embeddings.ts` (Voyage client: batches, retries with backoff, size checks), `ingest-plan.ts` (what to keep, copy, embed or remove), `search.ts` (the SQL, similarity floor, citation ids). `src/lib/ai/tools.ts`: `search_lore`, and tools built per request with the session's world. `src/lib/session.ts` and `worlds.ts`: the world of a request. `src/lib/prompts/agent.v2.md`: a template filled with the characters of the visitor's world. `lore_chunks` in the schema. |
| **Tooling**     | `pnpm ingest` (with `--world`, `--config`, `--dry-run`) and `pnpm eval:retrieval`. `unified`, `remark-parse` and `mdast-util-to-string` for Markdown. CI starts a throw-away `pgvector/pgvector:pg17` Postgres and applies the migrations to it. `zod` and `vitest` at the repository root, and `evals/` added to the type-check and the test run. A standalone database client for scripts.                                                                                                                                                                                                               |
| **Documenting** | The Lore Bible and `data/lore/README.md`, ADR-0003, `evals/README.md`, the manuscript non-goal in the PRD, new README sections (lore and ingestion, searching the lore, database tests), and this report.                                                                                                                                                                                                                                                                                                                                                                                                  |

## 4. By environment

| Environment | Web app and model                                                          | Database                                                          | Lore and embeddings                                                              | Secrets                                                             |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Dev**     | `pnpm dev`. Haiku 4.5 by default.                                          | Docker Postgres with pgvector, migrations applied locally         | `pnpm ingest` writes to the local table. Voyage `voyage-4-lite` with the dev key | `apps/web/.env.local` (adds `VOYAGE_API_KEY` and `EMBEDDING_MODEL`) |
| **Preview** | One Vercel URL per pull request. Sonnet 5.5. The world cookie is `Secure`. | Supabase, with the `vector` extension and the `lore_chunks` table | Ingested into Supabase by hand: `pnpm ingest` with the connection string         | Vercel Preview variables (dev key)                                  |
| **Prod**    | Vercel, from `main`. Sonnet 5.5.                                           | The same Supabase project as Preview                              | The same rows as Preview                                                         | Vercel Production variables (prod key)                              |
| **CI**      | GitHub Actions: no model and no embedding key.                             | A throw-away Postgres with pgvector, created for each run         | The isolation test inserts its own test rows. Embeddings are faked in unit tests | None                                                                |

Migrations are applied by hand to Supabase (`pnpm --filter web db:migrate` with its connection string), and the lore is loaded the same way. Preview and Production share one Supabase project, so they share the lore.

## 5. Routing

| URL                               | File                                          | Kind     | Purpose                                                                                  |
| --------------------------------- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `/`                               | `src/app/(chat)/page.tsx`                     | Page     | The chat, now with a world selector                                                      |
| `POST /api/chat`                  | `src/app/api/chat/route.ts`                   | Endpoint | Streams answers. Reads the visitor's world from the session and builds the tools with it |
| `GET /api/session/world`          | `src/app/api/session/world/route.ts`          | Endpoint | The visitor's world and the list of worlds                                               |
| `POST /api/session/world`         | `src/app/api/session/world/route.ts`          | Endpoint | Remembers a known world in an HttpOnly cookie (400 for an unknown one)                   |
| `POST /api/feedback`              | `src/app/api/feedback/route.ts`               | Endpoint | Stores one feedback event (Day 2)                                                        |
| `GET /api/health`                 | `src/app/api/health/route.ts`                 | Endpoint | Liveness (Day 1)                                                                         |
| `GET /api/legacy/character-state` | `src/app/api/legacy/character-state/route.ts` | Endpoint | Development fallback (Day 1), now limited to the visitor's world                         |

The model never calls an endpoint of ours for lore: the `search_lore` tool runs inside `/api/chat`, on the server.

## 6. Unit tests and CI

**190 tests** (116 new today), Vitest. Almost all need no network, database or key. One file runs against a real Postgres.

| Area                | What is checked                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **World isolation** | **Against a real Postgres:** a query in one world never returns another world's chunks, even when they are the closest vectors, in both directions, for a world with no lore, and through the whole search. Removing the world filter on purpose made the test fail. |
| Tools               | The search tool's schema has no world field, and a world sent by the model is dropped. Another world's character gives exactly the answer of a missing one. A failure is returned as data.                                                                           |
| Chunking            | Heading paths nest and reset, a `#` in a code block is not a heading, no chunk exceeds the cap, no sentence is lost, overlap never crosses a heading.                                                                                                                |
| Ingestion plan      | A second run embeds and writes nothing. Only an edited chunk is embedded. A model change re-embeds all. A moved chunk keeps its vector. A deleted file removes its rows.                                                                                             |
| Embedding client    | Batches keep their order, 429 and 5xx are retried with backoff, `Retry-After` is obeyed, a wrong key is not retried and never appears in an error, a wrong vector size is rejected.                                                                                  |
| Lore files          | Windows and Unix line endings give the same result. The real Lore Bible is valid.                                                                                                                                                                                    |
| Session and prompt  | Only known worlds are accepted, bad cookies fall back to the default, the character list in the prompt is per world.                                                                                                                                                 |
| Citation cards      | Collapsed by default, snippet and id shown, text escaped, empty, loading and error states.                                                                                                                                                                           |
| Retrieval eval      | The scoring code against numbers worked out by hand. The real question set is valid, and every label points at a section that exists.                                                                                                                                |

**CI** now also starts a throw-away Postgres with pgvector, applies the migrations to it (which proves they run on an empty database) and runs the tests, including the isolation test. If the database setting is missing in CI, a guard test fails, so the isolation test cannot be skipped silently. `next build` is still not run by CI; the Vercel preview build does it.

## 7. What is stored: the lore and its index

**Source of truth: the Markdown files** in `data/lore/<world_id>/`. The folder name is the world's id, the same one the legacy CMS uses. Each file starts with a `doc_type` (`rule`, `location`, `history` or `character`), then headings and text.

| World          | Files                                                                                              | Content                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `world_aethel` | `magic-system`, `ice-citadel`, `ember-keep`, `glass-library`, `history-and-factions`, `characters` | Rules of mana and spells, three places, the history and factions, three characters  |
| `world_nox`    | `magic-system`, `locations`, `characters`                                                          | A smaller world with look-alike rules and different values, for the isolation tests |

The Aethel files contain specific rules that a question can target, and a few passages that deliberately conflict or are ambiguous. The lore describes what is always true of a world. Live character state stays in the CMS, and the manuscript is not stored (a PRD non-goal).

**The index** is the table `lore_chunks` in Postgres, one row per chunk. It can always be rebuilt from the files.

| Column                            | Meaning                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                              | uuid. Its first 8 characters are the **citation id**                                            |
| `world_id`                        | The tenant. Every search filters on it                                                          |
| `chunking`                        | The name of the chunking configuration, so several can sit side by side                         |
| `source_path`, `chunk_index`      | The file and the position of the chunk in it (unique together with the world and configuration) |
| `doc_type`, `heading_path`        | The kind of document, and the headings above the chunk (for example `Magic > Casting Rules`)    |
| `content`                         | The chunk's text, shown in the card and given to the model                                      |
| `embedding`                       | `vector(1024)`, the search key                                                                  |
| `embedding_model`, `content_hash` | Which model made the vector, and a hash of the model plus the exact text that was embedded      |
| `token_estimate`, timestamps      | Size and bookkeeping                                                                            |

**Idempotent ingestion.** The hash decides what happens to each chunk: unchanged chunks are kept, a chunk that only moved reuses its stored vector, new text is embedded (once, even if it appears twice), and rows that no longer correspond to a chunk are removed, all in one transaction. Changing the embedding model changes every hash, so everything is embedded again. The command prints the tokens it sent and their cost at list price.

**Chunking.** Each file is cut at its headings. A section longer than the cap is cut at paragraphs, then sentences, then words, with a small overlap that never crosses a heading. The text that is embedded starts with the heading path. Two named configurations exist (`heading-800`, the default, and `heading-80`). The table has Row Level Security switched on with no policies, like `feedback_events`, and has no vector index: at this size an exact scan is exact and fast.

## 8. How a lore question is answered

1. The browser sends the chat. **The server** reads the visitor's world from the session cookie, checks it against the known worlds, and builds the tools for this request with that world inside them. It also fills the prompt's character list with that world's characters only.
2. The model may call **`search_lore({ query, k? })`**. The schema has no world field, so the model can neither choose nor see the world.
3. The tool embeds the question (Voyage, as a question), then runs one SQL query: nearest chunks by cosine distance, `WHERE world_id = <session world> AND chunking = <default>`, top 3 (at most 8).
4. Passages below a cosine similarity of **0.30** are dropped, so an off-topic question returns nothing. A question that names real things of the lore but is not answered by it can still return passages, and the prompt tells the model to say that the lore does not cover it. The value is provisional.
5. Each passage is returned with a citation id, its file, its heading path and its text. A failure is returned as data (`ok: false`), not thrown.
6. The model answers from the passages, cites them as `[id]`, says so when two passages disagree, and treats passage text as data, not as instructions. The browser draws the passages as cards.

For a question that needs both a rule and a character's state, the prompt tells the model to read the state first and then search with what it learned (for example the place the character is in), because the search cannot know it otherwise.

**The world in the session is a stand-in.** There is no sign-in yet, so the world comes from an HttpOnly cookie set by the world selector and checked against a list. It is not authentication: any visitor can pick any known world. It exists so that the rule "the world comes from the server, never from the model" has exactly one place to live, which sign-in will replace. The same session world also limits the **character tool** (another world's character gives exactly the answer of a missing one), the **prompt's character list**, and the **fallback route**.

## 9. What the UI can do (new today)

| Capability        | Detail                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Lore sources      | After a lore question the chat shows the passages as cards: heading, file and kind, the citation id the answer cites, and a snippet. |
| Open a passage    | Each card opens to the full text (keyboard accessible, no extra script).                                                             |
| States            | A skeleton while searching, a "No matching lore" card, and an error card when the search is unavailable. The chat keeps working.     |
| Choose a world    | A selector in the header. Changing it starts a new conversation, because earlier messages belong to the other world.                 |
| Not available yet | Sign-in, uploading lore, editing lore from the chat, and showing which sentence of a passage supports which claim.                   |

## 10. The retrieval eval

A way to measure the search **on its own**, with no model writing an answer.

- **The question set** (`evals/retrieval.jsonl`): 36 questions. For each, the **sections** of the lore (a file and a heading path) that answer it, graded 2 (answers) or 1 (related). Four questions have no answer in the lore. Questions are tagged by kind (number, proper noun, paraphrase, several passages, conflict, a misleading passage, and so on).
- **Labels name sections, not chunks.** Chunk boundaries change with every chunking configuration, so labels written against chunks would break when two configurations are compared. In scoring, a retrieved chunk counts as the section it was cut from, rank is counted in chunks, and a section counts once.
- **The scoring code** (`evals/retrieval-metrics.ts`) computes hit rate, recall, precision, MRR and nDCG, and is tested against numbers worked out by hand.
- **The command** `pnpm eval:retrieval` runs the same search the chat uses, for any stored chunking configuration (`--config`), any top-k (`--k`), with a per-question view (`--verbose`) or JSON (`--json`).
- **Guards:** a test fails if a label points at a section that does not exist (for example after a heading is renamed). The set was committed before the scoring code was ever run and is not edited to fit a result.

## 11. ADR-0003

**Cut the lore at its headings, search it by cosine similarity in Postgres, and keep each world apart inside the query.** The record lists the options for chunking, the embedding model, storage and search, and world isolation, with pros and cons, and states the consequences, including the downsides (exact search will not scale to very large worlds, quality depends on how the author structures the lore, the similarity floor belongs to one embedding model, the world stand-in is not authentication). It is written to be extended with a dated update note.

## 12. Additional items

- Windows line endings are normalized when lore files are read, so the same file gives the same chunks and hashes on every machine.
- Voyage requests send the vector size and refuse over-long texts instead of truncating them silently.
- A character of another world is indistinguishable from a character that does not exist, and the prompt never names another world's characters. The older fallback route is limited the same way.
- A manual check of the real agent found that calling the state tool and the lore search at the same time loses the place the character is in, so the second prompt version asks for them in order.
- The Supabase Security Advisor reports the `vector` extension in the `public` schema. This is accepted on purpose, so the local and hosted databases stay identical.
- Not built: hybrid search (keyword plus vector), a reranker.

## 13. Known limits

- There is **no sign-in**. The world cookie is a stand-in, and any visitor can pick any known world.
- Preview and Production share one Supabase project, so they share the lore. Both load it by hand.
- The character list per world in the prompt is written by hand and can drift from the CMS.
- Search quality depends on the question the model writes. Passages that are outdated or misleading can rank high, and the assistant has to read them critically.
- The similarity floor of 0.30 is provisional and belongs to the current embedding model. It cannot tell an unanswerable question that mentions real names from a real one, so for those the assistant has to notice that the passages do not answer the question.
- The question set was written by one person and is small, so it shows trends, not precise numbers. Section-level scoring cannot see whether only part of a section answers the question.
- Exact search compares the question with every chunk of the world. That is fine for hundreds of chunks and has to be revisited for much larger worlds.
- The dev model sometimes announces a tool call in a separate text bubble. The Preview and Production model was not checked for this.
- ESLint does not cover the `evals/` folder (the type-check, tests and Prettier do).
