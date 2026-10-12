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

# Agent prompt set

`agent-prompts.json` holds ten questions about the seeded characters, run through the agent graph without a browser. Seven of them are written to tempt the agent into breaking a rule of the world or using something the character does not carry: a ban that has an exception, an old price, a request that reaches into the other world, a spell that costs more mana than the character has. The others are plain requests and a conflict in the data. They show how often a first draft breaks a rule and how often the reflection step catches it.

| File                    | What it is                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `agent-prompts.json`    | The prompts                                                                                  |
| `agent-prompts.ts`      | Reads and validates the set                                                                  |
| `agent-prompts.test.ts` | Checks the format, and that every character exists in its world and is named in the question |

One prompt, as written:

```json
{
  "id": "no-flint-02",
  "input": "Brannoc Hale is trapped in the Ice Citadel. Have him burn through the door with a fire spell.",
  "character_id": 2,
  "world_id": "world_aethel",
  "expected_tools": ["fetch_character_state", "search_lore"],
  "tempts_rule_break": true,
  "tags": ["rule", "inventory", "trap"],
  "note": "Three reasons it cannot work: ..."
}
```

- **`expected_tools`** are the tools a good run uses, in any order. The prompt names the character, because the chat has no character selector: the agent finds the id from the list of the world's characters.
- **`note`** says what is right and what makes the prompt hard. It is for the reader, not for the agent. Every note was written against the lore in `data/lore` and the seed data of the legacy CMS.
- **Do not change a prompt to make a result look better.** Add new prompts instead, and change an existing one only when the lore or the seed data change, in its own commit with the reason.

# End-to-end eval

`pnpm eval` runs the whole agent (drafting, tools and reflection) on every case of `datasets/e2e.json`, without a browser, and grades each answer twice. The retrieval eval above says whether the right passages are found; this one says whether the author gets a correct answer.

```sh
pnpm eval                                      # every case: Sonnet 5.5 under test, Opus 5.5 judging
pnpm eval --only fire-escape-01,no-flint-02    # a few cases, by id
pnpm eval --agent-model claude-haiku-4-5       # another model under test (cheaper)
pnpm eval --no-judge                           # code checks only: no judge call
pnpm eval --label baseline                     # adds a label to the report's file name
```

It needs the same local services as the chat (`docker compose up -d`, and the lore ingested with `pnpm ingest`) and the keys in `apps/web/.env.local`. It calls the real models and prints its own cost at the end. Cases run one at a time, once each.

| File                | What it is                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `datasets/e2e.json` | The cases                                                                                                                    |
| `e2e-dataset.ts`    | Reads and validates the cases                                                                                                |
| `e2e-checks.ts`     | The code checks: tools, items and citations                                                                                  |
| `e2e-judge.ts`      | The judge: rubric, reply schema, consistency rule and cost                                                                   |
| `e2e-report.ts`     | Decides whether a case passes, and sums the results                                                                          |
| `judge.ts`          | The command: runs the cases, grades them and writes the report                                                               |
| `reports/`          | One JSON report per run: the setup, every answer, every grade and the summary                                                |
| `*.test.ts`         | Unit tests for all of the above (no model is called). One checks the cases against the real world list and the agent prompts |

## The cases

```json
{
  "id": "fire-escape-01",
  "input": "Aria Voss is trapped in the Ice Citadel. Suggest an escape that uses fire magic.",
  "character_id": 1,
  "world_id": "world_aethel",
  "expected_constraints": [
    "Says fire magic is normally smothered inside the Ice Citadel and that Aria's flint is the exception"
  ],
  "expected_tools": ["fetch_character_state", "search_lore"],
  "tags": ["happy-path", "rule", "inventory"],
  "note": "Why the case exists, and what is right."
}
```

- **The first ten cases are the agent prompts** (`agent-prompts.json`), unchanged, with constraints added. A test fails if one drifts. The others add a rule exception, a healer who cannot heal herself, a character that does not exist, lore that does not cover the question, a legacy service that is down, an off-topic request, a lore-only question and two questions in the other world.
- **`expected_constraints`** are one checkable sentence each, written by hand from the lore and the seed data. The judge marks each as pass or fail.
- **`expected_tools` / `forbidden_tools`** are checked by code. `character_id` can be `null` for a question about no character.
- **`legacy: "down"`** swaps the legacy service for one that always fails, for the case that checks the agent says "unavailable" instead of guessing.
- **`tempting_items`** names items a request invites that nobody carries (a rope, a Tide-key), so the item check looks for them.

## How a case is graded

A case passes when every code check holds **and** the judge passes it.

**Code checks** (no model):

- **Tools:** every expected tool was called and no forbidden one.
- **Items:** an item of the world (any item in the CMS, plus the case's `tempting_items`) named in the answer must be one the character carries. A mention in a clause that denies it ("carries no rope") is allowed. This is text matching: it does not see a paraphrase, and its denial cues are a short word list.
- **Citations:** every bracketed id in the answer (`[3fa9c1d2]`) is a real chunk of the question's world. A real chunk that no search returned in that run is reported but does not fail the check.

**The judge** (Claude Opus 5.5, through structured outputs) sees the question, the evidence the agent had (the passages and the character lookup), the true character record, the answer and the numbered constraints. It writes its reasoning first, then gives a **faithfulness** score from 1 to 5 and a pass or fail for each constraint. The answer passes only when faithfulness is 4 or more and every constraint passes, whatever the judge's own `pass` says. A reply that is missing a constraint is asked for again once, and then reported as a judge error, not as a pass or a fail.

| Faithfulness | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| 5            | Every claim is supported by the evidence                                                      |
| 4            | Every rule, number, item and place is supported; at most one small neutral detail goes beyond |
| 3            | One unsupported or wrong claim that could matter to the story                                 |
| 2            | Several unsupported claims, or one that contradicts the evidence                              |
| 1            | The core is invented, or it contradicts the rules or the character's state                    |

## Limits to keep in mind

- **One run per case.** Agent and judge both vary between runs, so a single pass or fail is one draw. Opus 5.5 accepts no temperature other than its default, so the judge cannot be run at temperature 0.
- **The judge is a model.** Its agreement with a human is measured on hand labels (see `docs/METRICS.md`); until then, read its scores with care. Judge and agent are from the same model family.
- **The set is small and written by one person.** Do not change a case or a constraint to make a result look better; change one only when the lore or the seed data change, in its own commit with the reason.
- **Reports are machine output.** Keep a report in Git only when a document refers to it.
