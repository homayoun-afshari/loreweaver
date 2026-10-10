# Retrieval eval

Measures the lore search **on its own**: no model writes an answer. For each question in `retrieval.jsonl` it runs the same search the chat uses and scores the ranking against the sections of the lore that really answer the question. If retrieval misses the rule, no prompt can repair the answer, so this is checked first.

```sh
pnpm eval:retrieval                        # default chunking configuration, top 3
pnpm eval:retrieval --config heading-80    # another stored configuration (see "pnpm ingest --config")
pnpm eval:retrieval --k 5                  # the top 5 instead of the top 3
pnpm eval:retrieval --verbose              # one line per question: what was found, and where
pnpm eval:retrieval --json                 # the whole result as JSON
```

It needs the local Postgres to be running and the lore to be ingested for the configuration it measures (`pnpm ingest --config <name>`), and an embedding key in `apps/web/.env.local`. It embeds about forty short questions in one request: a fraction of a cent.

| File                   | What it is                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `retrieval.jsonl`      | The eval set: one question per line, with the sections that answer it                  |
| `retrieval-dataset.ts` | Reads and validates the eval set, and checks that every label points at a real section |
| `retrieval-metrics.ts` | The metrics: hit rate, recall, precision, MRR and nDCG                                 |
| `retrieval.ts`         | The command: embeds the questions, runs the search, scores it, prints the table        |
| `*.test.ts`            | Unit tests. The metrics are checked against numbers worked out by hand                 |

## The eval set

One JSON object per line:

```json
{
  "id": "q02",
  "world": "world_aethel",
  "query": "How much mana does teleportation cost?",
  "tags": ["numeric", "trap"],
  "relevant": [
    {
      "file": "magic-system.md",
      "heading": "The Magic of Aethel > Casting Rules > Teleportation",
      "grade": 2
    },
    { "file": "magic-system.md", "heading": "The Magic of Aethel > Old Figures", "grade": 1 }
  ]
}
```

- **A label names a section** (a file and its heading path, as shown in citations), not a chunk. Chunk boundaries and ids change with every chunking configuration, so labels written against chunks would break exactly when two configurations have to be compared.
- **Grade 2** means the section answers the question. **Grade 1** means it is related or gives partial context.
- **A question the lore cannot answer** has no labels and the tag `negative`. It is not part of the metrics. It is used to check the similarity floor of the search (below).
- **Tags** describe the kind of question (`numeric`, `proper-noun`, `paraphrase`, `multi-section`, `conflict`, `trap`, and so on), so the results can be read per kind.
- The eval set is written by hand against the lore in `data/lore`. A unit test checks that it is valid and that every label points at a section that exists, so editing the lore cannot silently break a label.

## How a ranking is scored

The search returns the closest chunks of the question's world, best first (10 are retrieved). Each chunk counts as the **section** it was cut from.

- **Rank is the position among chunks.** A configuration that cuts a section into several pieces pays for it: the pieces take up places in the top _k_.
- **A relevant section counts once**, the first time one of its chunks appears. Later chunks of the same section add nothing.

| Metric          | Meaning                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| **hit@k**       | Share of questions with at least one relevant section in the top _k_                                |
| **recall@k**    | Relevant sections found in the top _k_, divided by all the relevant sections of the question        |
| **precision@k** | Relevant sections found in the top _k_, divided by _k_                                              |
| **MRR**         | Mean of 1 / rank of the first relevant chunk (0 if none), looking 10 chunks deep                    |
| **nDCG@k**      | Ranking quality with graded relevance: gain / log2(rank + 1), divided by the best possible ordering |

The printed table shows the mean over all questions with an answer, and the same per tag.

**The similarity floor.** The search drops passages whose cosine similarity is below a floor (`MIN_SIMILARITY` in `apps/web/src/lib/rag/search.ts`), so a question the lore does not cover returns nothing. The report shows how many unanswerable questions get nothing (good) and how many answerable ones would wrongly get nothing (bad).

## Limits to keep in mind

- The set is small, so one question changes a mean by a few points. Read differences between configurations as suggestions, not proof.
- It was written by one person. Questions and labels reflect that person's idea of what is relevant.
- **Do not change questions or labels to make a result look better.** The set is committed before anything is tuned, so that later changes cannot quietly move the goalposts. A change to the set belongs in its own commit, with the reason.
