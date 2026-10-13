# Day 3: LoreBible, RAG, and Tools v2

The full account is in the [Day 3 report](../reports/day-3.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **LoreBible:** the canon of two worlds as Markdown files, in a documented format.
- **RAG:** `pnpm ingest`, which cuts the lore at its headings, embeds it with Voyage AI and stores it in Postgres with pgvector, safe to run again; and a labeled question set that scores the search with no model.
- **Tools v2:** `search_lore`, which returns the passages that answer a question with citation ids, shown as Lore Citation cards, with every lookup limited to the visitor's world.

## Documents Involved

- **ADR:** [ADR-0003](../adr/0003-chunking-and-retrieval.md), the lore as data, chunking, the embedding model, vector search and keeping worlds apart.
- **PRD:** [updated](../PRD.md) with a new non-goal: the author's manuscript is neither stored nor searched.
- **Architecture Diagram:** [the lore, its ingestion, the vector database and the search tool](Day03_LoreBible_RAG_Toolsv2.svg).
- **Report:** [lore, embeddings and retrieval](../reports/day-3.md).
- **Metrics:** Updated.

## Decisions Made

- **Lore as a Snapshot:** the files are the source of truth, the vector table is derived from them, and the product never changes the lore.
- **Chunking at Headings:** `heading-800` is the default, and the heading path stays in the embedded text.
- **One Embedding Model:** the same model embeds chunks and questions, and changing it re-embeds everything.
- **Exact Vector Search:** cosine similarity in Postgres with no vector index, the top 3 passages, and a similarity floor of 0.30.
- **World Isolation:** the world comes from a server-side cookie and sits in the SQL `WHERE` clause; the tools have no world parameter.

## Metrics Measured

- **Retrieval Quality:** recall, precision, MRR and nDCG at 3 for three chunking configurations, on the labeled question set.
- **Similarity Floor:** how many questions with and without an answer each floor silences.
- **Retrieval Latency:** the time to embed the question and to search the vectors.
- **Ingestion Cost:** the tokens billed, the cost, the time and the table size of indexing the lore.
- **Search Tool on Production:** the time of the `search_lore` tool on the deployed app, compared with local.
