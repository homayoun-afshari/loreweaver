# ADR-0003: Cut the lore at its headings, search it by cosine similarity in Postgres, and keep each world apart inside the query

**Status:** Accepted · **Date:** 2026-10-10 · **Owner:** Homayoun Afshari

## Context

Loreweaver answers questions about an author's world from the author's own lore: the rules of magic, places, history and character backgrounds (see [PRD](../PRD.md)). The model has never seen that text and it changes, so the assistant has to **retrieve** the relevant passages for each question and answer from them. If retrieval misses the rule, no prompt can repair the answer, so retrieval is designed, and measured, on its own.

Four things have to be decided: how to cut the lore into pieces, which model turns text into vectors, where the vectors live and how they are searched, and how one author's lore is kept away from another's.

Constraints:

- The lore is Markdown written by people, with headings. The sections of the current lore are short (the longest is about 180 tokens), so a heading is already a natural unit of meaning.
- The PRD guardrails: **zero cross-tenant leaks**, p95 latency under 8 s from question to complete answer, cost per query under $0.05, and answers that point to the passages they come from. A question the lore does not cover must not be answered from the least-bad passage.
- The data is small (about a hundred chunks per world), and the project has a small budget, so cost and operational weight matter more than raw scale.
- Embedding a question is a network call to a third party, so it adds to every answer's latency.
- The lore files stay the source of truth. Whatever is stored for search must be rebuildable from them.

## Options considered

### 1. Chunking

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

### 2. Embedding model

1. **Voyage `voyage-4-lite`** (1024 dimensions, USD 0.02 per million tokens, a free allowance of 200 million tokens).
2. **OpenAI `text-embedding-3-small`** (about the same price, no free allowance, a second provider if a reranker from Voyage is added later).
3. **A larger Voyage model** (`voyage-4`, `voyage-4-large`): more expensive per token and not needed to know whether it is better on this data.

### 3. Where the vectors live, and how they are searched

1. **In memory.** Pros: nothing to run. Cons: lost on restart and not shared between serverless instances, so it is only suitable for tests.
2. **A dedicated vector service** (for example Pinecone). Pros: built for scale. Cons: one more account and system, and the world filter and the lore metadata would live in a different place from the rest of the data.
3. **Postgres with pgvector, comparing the question with every chunk of the world (exact search).**
   - Pros: the vectors, their labels and the world sit in the database the app already has, in Development and in Supabase. One filter, one query, one backup. The result is exact.
   - Cons: the time grows with the number of chunks.
4. **Postgres with pgvector and an approximate index (HNSW or IVF).**
   - Pros: much faster at large sizes.
   - Cons: slower to build, more memory, and it can miss a true neighbor. A strict filter combined with an approximate index can also return fewer results than asked for. At a few hundred chunks it brings no benefit.

### 4. Keeping worlds apart

1. **Tell the model to stay in the author's world.** Cons: the model is not a security boundary.
2. **Filter the results after the search.** Cons: forbidden chunks take up places in the top results, and they pass through the server before they are dropped.
3. **Put the world in the `WHERE` clause of the search, with the world taken from the session on the server, and no world parameter in the tool the model sees.**
   - Pros: a chunk of another world is never a candidate, however close its vector is. The model cannot choose, see or change the world.
   - Cons: every query path has to remember the filter, so it needs a test that proves it.
4. **One table (or database) per world.** Pros: strong separation. Cons: more migrations and objects for no gain at this size.
5. **Row Level Security policies in the database.** Pros: defense in depth. Cons: more moving parts, and the app connects as the database owner, which bypasses them. A candidate follow-up.

## Decision

- **Chunking: option 2.** Each file is cut at its headings. A section longer than the cap is cut at paragraphs, then sentences, then words, with a little overlap that never crosses a heading. Each chunk keeps its heading path. The text that is embedded is the heading path followed by the chunk, so a chunk that only says "it requires flint" still carries its topic. The cap and overlap are named **configurations** that are stored with each chunk, so several can sit side by side and be compared without embedding again. `heading-800` is the default for now. Because every current section is under about 180 tokens, any cap of 200 or more gives the same chunks, so the second configuration is `heading-80`, the first size at which the long sections really split. The choice between them is made by the measured comparison.
- **Embedding model: option 1.** The same model embeds the chunks (as documents) and the questions (as questions). Its name is stored with each chunk, and it is part of the hash that decides whether a chunk must be embedded again, so changing the model re-embeds everything.
- **Storage and search: option 3.** The table `lore_chunks` holds the text, the vector, the world, the file, the heading path and the kind of document. The search orders by cosine distance and takes the top 3 (at most 8). There is **no vector index**. The lore files are the source of truth, and `pnpm ingest` rebuilds the table from them: it skips chunks whose text and model are unchanged, and removes chunks that no longer exist.
- **Isolation: option 3.** The world comes from the session on the server (a stand-in until there is sign-in, see below), is bound when the tools are built for a request, and is a condition of the `WHERE` clause. The model's tool has no world parameter. A test against a real Postgres checks that a query in one world never returns another world's chunks, and the same rule is applied to the character tool and to the system prompt.
- **A question the lore does not cover returns nothing.** Passages with a cosine similarity below **0.30** are dropped. The value is provisional: it was chosen from eight hand-written questions with this model (relevant ones scored 0.50 to 0.75, unrelated ones 0.14 to 0.25) and is checked again against the eval set.
- **Citations.** Every returned passage carries a short, stable id (the first 8 characters of its row id), its file and its heading path. The answer cites passages as `[id]`, and the chat shows each one as a card with the same id.
- **How retrieval is measured.** A labeled eval set (`evals/retrieval.jsonl`) names, for each question, the **sections** (file and heading path) that answer it, with a grade of 2 for answers and 1 for related context, and a few questions the lore cannot answer. Labels name sections, not chunks, because chunk boundaries change with the configuration. Scoring is described in the [evals README](../../evals/README.md).
- **Not decided here:** hybrid search (keyword and vector, fused) and a reranker. Both are options for later, and the eval set exists to tell whether they are worth their cost.

## Consequences

**Positive**

- Chunks follow the author's own structure and carry the name of the section they come from, which makes citations meaningful.
- Vectors, labels and worlds live in one database, in every environment, and the search is exact.
- One place decides the world, and one test proves the separation, so a future sign-in replaces a single function.
- Ingestion is idempotent and cheap: a second run costs nothing, and an edit re-embeds only what changed.
- Retrieval can be measured without a model call, and two chunking configurations can be compared on the same labels.

**Negative**

- The search time grows with the number of chunks per world. This is fine for hundreds of chunks, and has to be revisited (an approximate index, with its recall checked against the exact result) when worlds are much larger.
- Quality depends on how the author structures the lore. Text without headings becomes one large section that the size cap then cuts blindly.
- A search is only as good as the question the model writes. The model decides the query, and a vague one can miss the rule.
- The similarity floor belongs to one embedding model's scale. Changing the model means choosing it again.
- The world stand-in is not authentication: any visitor can pick any known world. The code only guarantees that the world is decided on the server, never by the model.
- Preview and Production share one Supabase project, so their lore is shared, and separated only by world.
- The `vector` extension is installed in the `public` schema, which the Supabase Security Advisor reports as a warning. It is accepted on purpose, to keep the local and hosted databases identical.

## Follow-ups

- **Add the measured results to this record** as a dated update note: the comparison of the chunking configurations (recall, MRR and nDCG at 3), the retrieval latency, and the ingestion cost and index size, with the figures in [METRICS.md](../METRICS.md).
- Check the similarity floor against the eval set: how many unanswerable questions it silences, and how many answerable ones it would wrongly silence.
- Evaluate hybrid search (Postgres full-text and vectors, fused by rank) and a reranker, which matter most for proper nouns and for misleading passages such as an outdated figure.
- Add an approximate index only when the number of chunks or the latency requires it, and measure its recall against the exact search first.
- Replace the world stand-in with the signed-in author's world, and consider Row Level Security policies as a second layer.
- Add a check that an answer only cites ids that the search returned.

## Update 2026-10-10: measured results

The strategy was measured on the labeled question set (32 questions with an answer, 4 without) with three configurations. Figures, method and caveats are in [METRICS.md](../METRICS.md).

- **Chunking decision confirmed: `heading-800` stays the default.** It finds a relevant section in the top 3 for all 32 answerable questions (recall 0.92, MRR 0.96, nDCG 0.91 at 3). Cutting at 80 tokens gave the same recall and nDCG, moved single questions in both directions, and cost 56% more chunks, 12% more embedding tokens and 45% more storage. Chunk size did not matter at this scale, which matches the earlier observation that every section is already short.
- **The heading prefix on the embedded text stays.** Without it recall fell from 0.917 to 0.891, nDCG from 0.910 to 0.890, and one question was missed entirely. The difference is within what one or two questions can cause, so it is evidence in favor, not proof.
- **A correction to the Decision above.** The similarity floor of 0.30 silences off-topic questions, but it does **not** make the search return nothing for every unanswerable question. Two unanswerable questions that name real places or ideas of the lore scored 0.39 and 0.45, inside the range of real questions (the weakest scores 0.37), and raising the floor to 0.45 would silence 3 of the 32 real questions. The floor stays at 0.30 because it loses no real question. For the in-domain gap the system relies on the model reading the passages and saying that the lore does not cover the question, which it did in a manual check of two such questions. Whether a reranker or a rule on the best passage does better is open.
- **Retrieval is cheap in time and money.** About 0.35 s at p50 and 0.43 s at p95 per search (about 5% of the 8 s budget), of which the embedding request is about 85%. Indexing the whole lore costs about 6,100 tokens (USD 0.00012) and 0.5 MB.
- **The weak spots are paraphrases and questions that need several passages** (nDCG about 0.82 and 0.88), which is where hybrid search and a reranker would be tried.

Follow-ups added by the measurements:

- Send the question's vector with fewer digits. On the development machine the 20 KB query parameter alone cost about 45 ms of a 53 ms search, and rounding it cut the search to 7 ms. The effect on ranking has to be checked first, and it may not exist on a hosted database.
- Find out why about one search in ten is slower on Production (0.6 to 0.8 s, against about 0.29 s at p50). The measurement of the deployed search tool (see METRICS.md) did not separate the embedding from the database, and it did not show whether the large-parameter delay exists on the hosted database. A new connection on a cold serverless start is a likely suspect.
- Grow the question set, especially unanswerable questions that mention real names, before relying on differences smaller than a few points.
