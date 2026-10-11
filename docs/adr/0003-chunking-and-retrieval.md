# ADR-0003: Cut the lore at its headings, search it by cosine similarity in Postgres, and keep each world apart inside the query

This record covers five linked decisions about retrieval: what the lore is as data, how it is cut into pieces, which model turns text into vectors, where the vectors live and how they are searched, and what is kept apart and how.

Loreweaver answers questions about an author's world from the author's own lore: the rules of magic, places, history and character backgrounds (see [PRD](../PRD.md)). The model has never seen that text and it changes, so the assistant has to **retrieve** the relevant passages for each question and answer from them. If retrieval misses the rule, no prompt can repair the answer, so retrieval is designed, and measured, on its own. The product-level assumptions are in the [PRD](../PRD.md#assumptions-v1); where character state comes from is recorded in ADR-0001.

## 1. The lore as data

### Context

Retrieval needs a body of text to search, and the PRD separates two kinds of data: the canon of a world, which rarely changes, and live character state, which belongs to the CMS. In v1 there is no real author behind either: both are prepared in advance as a **snapshot of one author's worlds at one moment**, and Loreweaver only reads them (PRD assumptions). The character state side of the snapshot is recorded in ADR-0001. For the lore, what the files are, who writes them, how they get into the search index and how they could change has to be fixed before anything is stored for search. Whatever is stored for search must be rebuildable from them.

### Options considered

1. **A snapshot prepared by the developer: Markdown files in the repository, one folder per world, indexed by a command.** Pros: readable, reviewable and versioned with the code; the headings carry the structure; the same files and command can later be fed by an authoring tool. Cons: changing the lore means editing files and indexing again, outside the product.
2. **Lore written or uploaded by the author through the product.** Pros: closest to a real product. Cons: an upload path, storage, editing from the chat and admin screens, which v1 rules out (PRD non-goals).
3. **Lore kept only in the database.** Pros: one store. Cons: the search index would become the source of truth, so it could not be rebuilt or reviewed.

### Decision

Option 1: the lore, like the character state, is a read-only snapshot in v1.

- **What it is.** The canon of each world: what is always true of it (rules, places, history, factions, character backgrounds). Live character state is not lore and belongs to the CMS.
- **Who writes it.** The developer, by hand, as Markdown, to describe two worlds at one moment, committed to the repository. The second, smaller world exists so that the separation of worlds can be tested.
- **Format.** One folder per world, named with the world id the CMS also uses (`data/lore/world_aethel/`). One file per topic, with a front matter block that sets `doc_type` (`rule`, `location`, `history` or `character`) and `#`, `##` and `###` headings that decide the chunks and their heading paths. The full rules are in [data/lore/README.md](../../data/lore/README.md).
- **How it gets in.** `pnpm ingest` indexes whatever files the folder holds. It is idempotent: unchanged chunks are skipped, changed ones are embedded again and removed ones are deleted, so each run is a new snapshot of the world.
- **Source of truth.** The files. The `lore_chunks` table is derived from them and can be rebuilt at any time.
- **How it changes.** Only outside the product: a file is edited and `pnpm ingest` runs again. Loreweaver never changes the lore: there is no upload, no editing from the chat and no sync with the author's own tools.

### Consequences

- The lore can be reviewed in a pull request like code, and the search table can be wiped and rebuilt without losing anything.
- The folder and the idempotent ingestion are the seam for later authoring: a version that lets authors write or upload lore only has to put files in place and run the same indexing.
- Quality depends on how the lore is structured. Text without headings becomes one large section that the size cap then cuts blindly.

### Follow-ups

- Authoring tools in a later version: lore written or uploaded by the author when starting a chat, or synced from their own tools, feeding the same files and indexing.

## 2. Chunking

### Context

The lore is Markdown written by people, with headings. The sections of the current lore are short (the longest is about 180 tokens), so a heading is already a natural unit of meaning. Answers must point to the passages they come from.

### Options considered

1. **Fixed-size pieces with overlap.**
   - Pros: trivial, predictable sizes, works for any text.
   - Cons: cuts through the middle of a rule or a section, and ignores the structure the author wrote. A chunk loses the name of the section it belongs to.
2. **Heading-aware pieces, with a size cap and a little overlap.**
   - Pros: each chunk is about one topic, the author's own structure decides the boundaries, and the headings above a chunk (its _heading path_, for example `The Magic of Aethel > Casting Rules > Teleportation`) become a label for citations and for the labels of the eval set.
   - Cons: quality depends on how well the files are structured. Sections can be very uneven in length, which the size cap has to handle.
3. **Semantic chunking** (cut where the meaning changes, found with embeddings).
   - Pros: topically clean chunks even without headings.
   - Cons: needs embedding calls during chunking, is slower and less deterministic, and gives no labels for citations. The headings already carry the structure here.
4. **Parent-document retrieval** (search small pieces, return the larger section).
   - Pros: precise matching with richer context.
   - Cons: two levels to store and link. Not needed while sections are short.

### Decision

Option 2. Each file is cut at its headings. A section longer than the cap is cut at paragraphs, then sentences, then words, with a little overlap that never crosses a heading. Each chunk keeps its heading path. The text that is embedded is the heading path followed by the chunk, so a chunk that only says "it requires flint" still carries its topic. The cap and overlap are named **configurations** that are stored with each chunk, so several can sit side by side and be compared without embedding again.

**`heading-800` is the default.** Because every current section is under about 180 tokens, any cap of 200 or more gives the same chunks, so it was compared with `heading-80`, the first size at which the long sections really split, and with `heading-800-plain`, the same chunks without the heading prefix. The comparison, on a labeled set of 32 answerable and 4 unanswerable questions (figures, method and caveats in [METRICS.md](../METRICS.md)):

- `heading-800` finds a relevant section in the top 3 for all 32 answerable questions (recall 0.92, MRR 0.96, nDCG 0.91 at 3). Cutting at 80 tokens gave the same recall and nDCG, moved single questions in both directions, and cost 56% more chunks, 12% more embedding tokens and 45% more storage. Chunk size did not matter at this scale, because every section is already short.
- **The heading prefix on the embedded text stays.** Without it recall fell from 0.917 to 0.891, nDCG from 0.910 to 0.890, and one question was missed entirely. The difference is within what one or two questions can cause, so it is evidence in favor, not proof.

**How retrieval is measured.** A labeled eval set (`evals/retrieval.jsonl`) names, for each question, the **sections** (file and heading path) that answer it, with a grade of 2 for answers and 1 for related context, and a few questions the lore cannot answer. Labels name sections, not chunks, because chunk boundaries change with the configuration. Scoring is described in the [evals README](../../evals/README.md).

### Consequences

- Chunks follow the author's own structure and carry the name of the section they come from, which makes citations meaningful.
- Retrieval can be measured without a model call, and chunking configurations can be compared on the same labels.
- The weak spots are paraphrases and questions that need several passages (nDCG about 0.82 and 0.88).

### Follow-ups

- Evaluate hybrid search (Postgres full-text and vectors, fused by rank) and a reranker, which matter most for proper nouns, paraphrases, questions needing several passages, and misleading passages such as an outdated figure. Neither is decided here; the eval set exists to tell whether they are worth their cost.
- Grow the question set, especially unanswerable questions that mention real names, before relying on differences smaller than a few points.

## 3. Embedding model

### Context

Embedding a question is a network call to a third party, so it adds to every answer's latency. The data is small and the project has a small budget.

### Options considered

1. **Voyage `voyage-4-lite`** (1024 dimensions, $0.02 per million tokens, a free allowance of 200 million tokens).
2. **OpenAI `text-embedding-3-small`** (about the same price, no free allowance, a second provider if a reranker from Voyage is added later).
3. **A larger Voyage model** (`voyage-4`, `voyage-4-large`): more expensive per token and not needed to know whether it is better on this data.

### Decision

Option 1. The same model embeds the chunks (as documents) and the questions (as questions). Its name is stored with each chunk, and it is part of the hash that decides whether a chunk must be embedded again, so changing the model re-embeds everything.

### Consequences

- Ingestion is idempotent and cheap: a second run costs nothing, and an edit re-embeds only what changed. Indexing the whole lore costs about 6,100 tokens ($0.00012) (see [METRICS.md](../METRICS.md)).
- The similarity floor (section 4) belongs to this model's scale. Changing the model means choosing the floor again.

### Follow-ups

- None beyond re-checking the floor if the model changes.

## 4. Where the vectors live, and how they are searched

### Context

The data is small (about a hundred chunks per world), so cost and operational weight matter more than raw scale. The PRD guardrails: p95 latency under 8 s from question to complete answer, cost per query under $0.05, and answers that point to the passages they come from. A question the lore does not cover must not be answered from the least-bad passage.

### Options considered

1. **In memory.** Pros: nothing to run. Cons: lost on restart and not shared between serverless instances, so it is only suitable for tests.
2. **A dedicated vector service** (for example Pinecone). Pros: built for scale. Cons: one more account and system, and the world filter and the lore metadata would live in a different place from the rest of the data.
3. **Postgres with pgvector, comparing the question with every chunk of the world (exact search).**
   - Pros: the vectors, their labels and the world sit in the database the app already has, in Development and in Supabase. One filter, one query, one backup. The result is exact.
   - Cons: the time grows with the number of chunks.
4. **Postgres with pgvector and an approximate index (HNSW or IVF).**
   - Pros: much faster at large sizes.
   - Cons: slower to build, more memory, and it can miss a true neighbor. A strict filter combined with an approximate index can also return fewer results than asked for. At a few hundred chunks it brings no benefit.

### Decision

Option 3.

- **Storage.** The table `lore_chunks` holds the text, the vector, the world, the file, the heading path and the kind of document. There is **no vector index**. `pnpm ingest` rebuilds the table from the lore files: it skips chunks whose text and model are unchanged, and removes chunks that no longer exist.
- **Search.** It orders by cosine distance and takes the top 3 (at most 8). A search takes about 0.35 s at p50 and 0.43 s at p95 (about 5% of the 8 s budget), of which the embedding request is about 85% (see [METRICS.md](../METRICS.md)).
- **Questions the lore does not cover.** Passages with a cosine similarity below **0.30** are dropped. The floor was first chosen from eight hand-written questions (relevant ones scored 0.50 to 0.75, unrelated ones 0.14 to 0.25), then checked against the eval set. It silences off-topic questions, but not every unanswerable one: two unanswerable questions that name real places or ideas of the lore scored 0.39 and 0.45, inside the range of real questions (the weakest scores 0.37), and raising the floor to 0.45 would silence 3 of the 32 real questions. The floor stays at 0.30 because it loses no real question. For the in-domain gap the system relies on the model reading the passages and saying that the lore does not cover the question, which it did in a manual check of two such questions.
- **Citations.** Every returned passage carries a short, stable id (the first 8 characters of its row id), its file and its heading path. The answer cites passages as `[id]`, and the chat shows each one as a card with the same id.

### Consequences

**Positive**

- Vectors, labels and worlds live in one database, in every environment, and the search is exact.
- Retrieval is cheap in time and money.

**Negative**

- The search time grows with the number of chunks per world. This is fine for hundreds of chunks, and has to be revisited (an approximate index, with its recall checked against the exact result) when worlds are much larger.
- A search is only as good as the question the model writes. The model decides the query, and a vague one can miss the rule.
- Preview and Production share one Supabase project, so their lore is shared, and separated only by world.
- The `vector` extension is installed in the `public` schema, which the Supabase Security Advisor reports as a warning. It is accepted on purpose, to keep the local and hosted databases identical.

### Follow-ups

- Add an approximate index only when the number of chunks or the latency requires it, and measure its recall against the exact search first.
- Send the question's vector with fewer digits. On the development machine the 20 KB query parameter alone cost about 45 ms of a 53 ms search, and rounding it cut the search to 7 ms (see [METRICS.md](../METRICS.md)). The effect on ranking has to be checked first, and it may not exist on a hosted database.
- Find out why about one search in ten is slower on Production (0.6 to 0.8 s, against about 0.29 s at p50, see [METRICS.md](../METRICS.md)). The measurement of the deployed search tool did not separate the embedding from the database, and it did not show whether the large-parameter delay exists on the hosted database. A new connection on a cold serverless start is a likely suspect.
- Find out whether a reranker or a rule on the best passage handles in-domain unanswerable questions better than the floor.
- Add a check that an answer only cites ids that the search returned.

## 5. Keeping worlds apart

### Context

The PRD guardrail is **zero cross-tenant leaks**. Two things have to be decided: what the unit of isolation is, and how the search enforces it. v1 has no accounts, and the co-writing team of the PRD shares one world among several authors.

### Options considered

What is kept apart:

1. **Each author.** Pros: matches a product with accounts. Cons: there are no accounts in v1, and a co-writing team shares one world, so an author is the wrong unit.
2. **Each world.** Pros: the data is already split by world (lore folders, the CMS's `world_id`), so one id scopes lore search, the character tool and the prompt alike. It also fits several authors per world later. Cons: without accounts it limits what a conversation can see, not who can open a world.

How it is enforced:

1. **Tell the model to stay in the author's world.** Cons: the model is not a security boundary.
2. **Filter the results after the search.** Cons: forbidden chunks take up places in the top results, and they pass through the server before they are dropped.
3. **Put the world in the `WHERE` clause of the search, with the world taken from the session on the server, and no world parameter in the tool the model sees.**
   - Pros: a chunk of another world is never a candidate, however close its vector is. The model cannot choose, see or change the world.
   - Cons: every query path has to remember the filter, so it needs a test that proves it.
4. **One table (or database) per world.** Pros: strong separation. Cons: more migrations and objects for no gain at this size.
5. **Row Level Security policies in the database.** Pros: defense in depth. Cons: more moving parts, and the app connects as the database owner, which bypasses them.

### Decision

Each world is the unit, enforced with option 3.

- **Each request has exactly one world**, decided on the server from an HttpOnly cookie that the world selector sets, and checked against the list of known worlds. It is bound when the tools are built for a request, and is a condition of the `WHERE` clause. The model's tool has no world parameter, and the model never sees, chooses or changes the world.
- **The same rule covers every path:** a test against a real Postgres checks that a query in one world never returns another world's chunks, and the character tool and the system prompt are scoped to the session's world too.
- **There is no author in the data model.** Any visitor can open any known world, so v1 must only hold worlds that are fine to show to everyone. A co-writing team shares a world simply by choosing the same one.
- **The list of worlds and their characters is kept by hand** in `apps/web/src/lib/worlds.ts`: world ids, labels, example questions and each world's character names and ids. The names and ids copy the CMS seed (see ADR-0001), so a change there has to be mirrored here.

### Consequences

- One place decides the world, and one test proves the separation, so a future sign-in replaces a single function: only `getSessionWorldId` in `apps/web/src/lib/session.ts` changes, because lore search, the character tool and the prompt already take the world from there.
- The world stand-in is not authentication: any visitor can pick any known world. The code only guarantees that the world is decided on the server, never by the model.

### Follow-ups

- Sign-in, with a list of the worlds each author may open; the session would check the chosen world against it.
- Row Level Security policies as a second layer.
