# Metrics

Every figure reported in the README is measured and recorded here, with how it was measured.

## Day 1: legacy CMS and legacy client

**What was measured:** how the legacy CMS behaves under its simulated flakiness (random 200 to 1500 ms delay, 5% `503`), and how well the web app's legacy client hides that flakiness.

### Setup

| Item         | Value                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target       | Legacy CMS in Docker on the same laptop (`http://localhost:8080`), so network time is close to zero                                                                                             |
| Code version | Commit `b4eedbf`                                                                                                                                                                                |
| Rate limit   | Raised from 30 to 100000 requests per minute for the run (`LEGACY_RATE_LIMIT_PER_MIN`, which `docker-compose.yml` lets a load test override). Otherwise `429` would hide what is being measured |
| Load         | 100 requests (baseline run) and 500 requests (for a steadier estimate); 4 at a time; characters 1 to 5 in turn                                                                                  |
| Client       | Default settings: 2 s timeout, up to 3 retries, backoff 200 ms doubling (capped 2 s) with jitter, circuit breaker                                                                               |
| Script       | `apps/web/scripts/measure-legacy.ts`, run with `tsx` through `pnpm measure:legacy`. Percentiles come from `apps/web/src/lib/stats.ts`, which has unit tests                                     |

### Results

**Phase 1: the CMS directly (no client)**

| Metric          | 100 requests          | 500 requests            |
| --------------- | --------------------- | ----------------------- |
| Status codes    | 95 x `200`, 5 x `503` | 477 x `200`, 23 x `503` |
| **Error rate**  | **5.0%**              | **4.6%**                |
| Latency mean    | 862 ms                | 874 ms                  |
| **Latency p50** | **860 ms**            | **873 ms**              |
| **Latency p95** | **1450 ms**           | **1473 ms**             |
| Latency max     | 1506 ms               | 2659 ms                 |

**Phase 2: through the legacy client**

| Metric                    | 100 calls            | 500 calls            |
| ------------------------- | -------------------- | -------------------- |
| **Success after retries** | **100.0%** (100/100) | **100.0%** (500/500) |
| HTTP attempts per call    | 1.07 (107 in total)  | 1.04 (522 in total)  |
| Latency mean              | 963 ms               | 926 ms               |
| Latency p50               | 893 ms               | 922 ms               |
| Latency p95               | 1726 ms              | 1503 ms              |
| Latency max               | 3115 ms              | 2582 ms              |

### Key findings

- **Latency and error rate match the design.** p50 about 870 ms and p95 about 1470 ms (a uniform delay of 200 to 1500 ms); about 5% of raw calls fail.
- **Retries remove the visible failures.** Success went from about 95% raw to 100% in both runs (none of the 600 calls failed).
- **The price of retries is small.** 4% to 7% extra HTTP calls and about 50 to 100 ms more on average; the slowest calls (2.6 to 3.1 s) are the ones that needed retries.
- **Budget:** the CMS lookup alone uses about 1.5 s (p95) of the 8 s target for a full answer.

### Caveats

- Measured locally, not against the cloud service. Cloud Run adds real network time and its first request after idle includes a cold start. The cloud service also keeps its 30 requests per minute limit, so it cannot be load-tested the same way without changing it.
- Concurrency of 4 matches the 4 PHP workers; heavier load would queue requests on the CMS and raise latency.
- The simulated failures are independent random events. Real outages come in bursts, which the circuit breaker is designed for but this test does not exercise (it is covered by unit tests).

### Reproduce

```sh
# 1. Start the CMS without the rate limit
LEGACY_RATE_LIMIT_PER_MIN=100000 docker compose up --build -d

# 2. Run the measurement (MEASURE_REQUESTS defaults to 100, MEASURE_CONCURRENCY to 4)
pnpm measure:legacy
MEASURE_REQUESTS=500 pnpm measure:legacy

# 3. Stop the CMS
docker compose down
```

On Windows PowerShell, set the variable first with `$env:LEGACY_RATE_LIMIT_PER_MIN = "100000"`.

**To reproduce the recorded numbers exactly,** check out commit `b4eedbf` first (`git checkout b4eedbf`). The measured code (the CMS, the legacy client and the script) has not changed since: only a comment in the script did, so the current code behaves the same. The CMS delays and failures are random, so a new run gives close numbers, not identical ones.

## Day 2: mini model benchmark

**What was measured:** the same five prompts sent to two Claude models through the real `POST /api/chat` route, to choose the model for the agent node (see ADR-0002). The scope, the prompts, the scoring rubric and all answers are in [BENCHMARK.md](BENCHMARK.md). This section has the numbers.

### Setup

| Item         | Value                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code version | Commit `414cddb`: the original three-line system prompt and no tools. Later commits added the tool and the longer `agent.v1.md` prompt |
| Target       | Local dev server and the real Anthropic API (dev key). The route is included, the legacy CMS is not                                    |
| Models       | `claude-haiku-4-5` ($1 / $5 per million input / output tokens) and `claude-sonnet-5-5` ($2 / $10)                                      |
| Load         | 5 prompts, 1 run each per model, one at a time, default sampling                                                                       |
| Script       | `apps/web/scripts/benchmark.ts`                                                                                                        |

**Definitions** (all measured by the script, client side): **TTFT** is the time from sending the request to the first text token. **Total latency** is the time until the stream ends. **Output tokens** are reported by the provider. **Tokens per second** is output tokens divided by (total latency minus TTFT). **Cost** is input and output tokens times the prices above.

### Results

| Model             | Avg TTFT | Avg total latency | Avg output tokens | Output tokens/s | Cost, 5 prompts | Avg quality (1 to 5) |
| ----------------- | -------: | ----------------: | ----------------: | --------------: | --------------: | -------------------: |
| Claude Haiku 4.5  |   669 ms |           2355 ms |               148 |              95 |         $0.0042 |                  3.8 |
| Claude Sonnet 5.5 |  1346 ms |           3998 ms |               330 |             133 |         $0.0178 |                  4.6 |

Per prompt (TTFT / total latency / output tokens). Prompt texts and per-prompt quality scores are in BENCHMARK.md.

| Prompt             | Haiku 4.5              | Sonnet 5.5              |
| ------------------ | ---------------------- | ----------------------- |
| P1 plot ideas      | 832 ms / 4721 ms / 315 | 1391 ms / 6321 ms / 563 |
| P2 rule check      | 626 ms / 1012 ms / 47  | 1514 ms / 2630 ms / 200 |
| P3 honesty         | 606 ms / 1801 ms / 111 | 1293 ms / 3348 ms / 254 |
| P4 structured list | 648 ms / 2177 ms / 143 | 1219 ms / 4142 ms / 362 |
| P5 prose           | 632 ms / 2063 ms / 125 | 1313 ms / 3550 ms / 273 |

### Key findings

- **Sonnet scored higher** (4.6 against 3.8), mainly on following instructions. Both models refused to invent the blacksmith's name.
- **Sonnet costs about 4.2x more per answer** ($0.0036 against $0.0008), **starts about 2x slower** (TTFT 1.35 s against 0.67 s) and writes about 2.2x more tokens.
- **Streaming speed is similar** (133 against 95 tokens/s): the latency gap is the slower start plus the longer answers.
- **The slowest answer** was Sonnet on P1 (6.3 s), against the 8 s p95 target; the CMS lookup alone uses about 1.5 s of that budget.

### Caveats

- Five prompts, one run each: a trend, not a precise number. An earlier run, with a script bug that lost the token counts, gave TTFT within about 10% of this one.
- One reader scored quality with an informal rubric, not blind. The LLM judge arrives on Day 6.
- A dev laptop: no Vercel network hop and no cold start. No CMS and no tools, so these numbers describe the model alone, not a full agent answer.
- The answers contain Markdown; the current prompt asks for plain text because the chat UI does not render Markdown.

### Reproduce

```sh
pnpm dev          # terminal 1 (needs ANTHROPIC_API_KEY in apps/web/.env.local)
pnpm benchmark    # terminal 2 (BENCHMARK_RUNS=3 repeats each prompt for steadier averages)
```

A run costs about two cents. The full answers go to `apps/web/scripts/.out/benchmark-latest.json` (git-ignored); the curated copy is in BENCHMARK.md.

**To reproduce the recorded numbers exactly,** check out commit `414cddb` first (`git checkout 414cddb`). On the current code the same command also exercises the `fetch_character_state` tool and the longer prompt, so the answers, token counts and timings will differ. Even on that commit, the models' answers and timings vary from run to run, so a new run gives close numbers, not identical ones.

## Day 2: chat with the tool (time to first UI)

**What was measured:** the question "What does Kael have on them?" sent through `POST /api/chat` with the `fetch_character_state` tool, timed the way a browser experiences the stream, plus the route's own timing. This is the full path: the model decides to call the tool, the CMS answers, the model writes one sentence. Script: `apps/web/scripts/measure-chat.ts`.

### Setup (chat)

| Item          | Value                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model         | `claude-sonnet-5-5` in both targets (the Preview and Production model, ADR-0002)                                                                                                                                                                                                                                                                                                                             |
| Local         | Dev server and the Docker CMS on the same laptop. Sonnet is chosen with the local-only model override. 10 runs                                                                                                                                                                                                                                                                                               |
| Prod          | `https://loreweaver-nine.vercel.app` with the CMS on Cloud Run, deployed from the working tree with the Vercel CLI (the same code as the final-touch commit). 30 runs, client and server timing                                                                                                                                                                                                              |
| Load          | One run at a time                                                                                                                                                                                                                                                                                                                                                                                            |
| Code version  | Commit `66c16db`, which added the script and the server timing                                                                                                                                                                                                                                                                                                                                               |
| Server timing | The chat route times each answer with `createChatTimer` (`apps/web/src/lib/ai/server-timing.ts`): the first tool call, the first text token and the end, sent with the answer as metadata (`serverFirstUiMs`, `serverTtftMs`, `serverTotalMs`). Its unit tests use a fake clock: the first tool call and the first text token are timed separately, the first moment is kept, and a missing kind stays empty |

| Metric               | Meaning                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **Time to first UI** | Until the model starts the tool call: the browser can draw the **card skeleton** from this moment |
| **Time to card**     | Until the tool result arrives: the browser can draw the **Character Status Card**                 |
| **TTFT**             | Until the first text token of the answer                                                          |
| **Total**            | Until the stream ends                                                                             |
| **Server** vs client | Server time starts when the route starts. Client time starts when the request is sent             |

### Results (chat)

| Metric                   | Local p50 | Local p95 | Prod p50 | Prod p95 |
| ------------------------ | --------: | --------: | -------: | -------: |
| Time to first UI, client |    761 ms |   1608 ms |   801 ms |   933 ms |
| Time to first UI, server |    749 ms |   1252 ms |   660 ms |   711 ms |
| Time to card, client     |   2092 ms |   2673 ms |  2192 ms |  2794 ms |
| TTFT, client             |   3219 ms |   3751 ms |  3070 ms |  4364 ms |
| TTFT, server             |   3038 ms |   3740 ms |  2915 ms |  4196 ms |
| Total, client            |   3225 ms |   3758 ms |  3071 ms |  4365 ms |
| Total, server            |   3054 ms |   3746 ms |  2926 ms |  4206 ms |

All 40 runs in the table succeeded and every card loaded (no error card), although the CMS fails about 5% of calls on its own: the client's retries hid it.

### Key findings (chat)

- **The skeleton can appear after about 0.8 s.** That is only the model deciding to call the tool, so a slow CMS does not delay it.
- **The card can appear at about 2.2 s** (the CMS and the tool add about 1.4 s), and **the first text token at about 3.1 s** (a second model step writes the answer).
- **Production is close to local.** On Production the client sees each moment 140 to 160 ms after the server does: the network and Vercel overhead.
- **A one-tool question has a p95 of 4.4 s** on Production (30 runs), inside the 8 s target. A full agent will add model steps.
- **The tail comes from the CMS.** Across three Production batches (50 runs), one run took 10.7 s: the card arrived at 9.8 s, so the tool call alone took about 8.6 s. The other 49 runs finished within 5.4 s.

### Caveats (chat)

- Local has 10 runs, so its p95 is the slowest run. Production has 30, which is steadier but small. The 10.7 s run shows that p95 depends on whether a slow CMS call lands in the sample; a p99 would need hundreds of runs.
- Production was deployed from the working tree with the Vercel CLI, so `/api/health` reports the commit of `HEAD` and not the unpushed changes.
- Output tokens per second is not reported: the answer is one sentence that arrives in a burst. Decode speed is in the benchmark section above.

### Reproduce (chat)

```sh
docker compose up -d legacy-cms                             # the CMS the tool calls
pnpm dev                                                    # terminal 1
MEASURE_MODEL=claude-sonnet-5-5 pnpm measure:chat           # terminal 2: local, client and server timing
MEASURE_URL=https://loreweaver-nine.vercel.app MEASURE_REQUESTS=30 pnpm measure:chat   # against Production
```

`MEASURE_REQUESTS` sets the number of runs (default 10). Each run costs about one cent.

**To reproduce the recorded numbers exactly,** check out commit `66c16db` first (`git checkout 66c16db`). The model's answers and the network vary, so a new run gives close numbers, not identical ones.

## Day 3: lore retrieval

**What was measured:** how well the lore search finds the passages that answer a question, **on its own** (no model writes an answer), for three ways of chunking the lore; how long a search takes; and what it costs to build the search index. The method and the scoring rules of the quality figures are in [`evals/README.md`](../evals/README.md); the strategy they support is in [ADR-0003](adr/0003-chunking-and-retrieval.md). This section has the numbers.

### Setup

| Item           | Value                                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code version   | Commit `cb1f815` (the scripts, the eval set and the lore it measured)                                                                                                                                                                                                   |
| Lore           | 9 files in 2 worlds: `world_aethel` (6 files) and `world_nox` (3 files)                                                                                                                                                                                                 |
| Eval set       | `evals/retrieval.jsonl`: 36 questions, of which 32 have an answer in the lore (26 Aethel, 6 Nox) and 4 do not. Labels are lore sections, graded 2 (answers) or 1 (related). Written before the scoring code was run, and not changed after the first result             |
| Embeddings     | Voyage `voyage-4-lite`, 1024 dimensions, the real API (dev key) over the internet from the laptop. Questions are embedded as questions, chunks as documents                                                                                                             |
| Database       | Postgres 17 with pgvector 0.8.7 in Docker on the same laptop. **A new, empty database for each configuration**, with every migration applied from scratch, so the ingestion cost and the sizes are those of a first run. No vector index: every search is an exact scan |
| Configurations | `heading-800`: cut at headings, cap 800 tokens (in practice one chunk per section). `heading-80`: cut at headings, cap 80 tokens. `heading-800-plain`: the same chunks as `heading-800`, but the heading path is not put in front of the embedded text                  |
| Quality        | Top 3 chunks of the question's own world. MRR looks 10 chunks deep                                                                                                                                                                                                      |
| Latency        | 36 questions asked 5 times each = 180 searches per run, one at a time, after 3 warm-up searches that are discarded. The search is the one the chat uses (top 3). Timing is taken around the embedding request and the database query                                    |
| Scripts        | `evals/retrieval.ts` (quality), `apps/web/scripts/measure-retrieval.ts` (latency), `apps/web/scripts/ingest.ts` (cost, which also prints the tokens)                                                                                                                    |

**Definitions.** Scored on lore **sections** (a heading of a file), not on chunks: a retrieved chunk counts as the section it came from, rank is counted in chunks, and a section counts once. **hit@3**: share of questions with a relevant section in the top 3. **recall@3**: relevant sections found in the top 3 divided by all relevant sections of the question. **precision@3**: relevant sections found divided by 3. **MRR**: mean of 1 / the rank of the first relevant chunk. **nDCG@3**: ranking quality with graded relevance, 1.0 is the best possible order. Means are over the 32 questions that have an answer. **Retrieval latency** is the time to embed the question plus the time of the database search.

### Results

**Retrieval quality, top 3, 32 questions with an answer**

| Configuration       | Chunks | hit@3 | **recall@3** | precision@3 |   **MRR** | **nDCG@3** |
| ------------------- | -----: | ----: | -----------: | ----------: | --------: | ---------: |
| `heading-800`       |     70 | 1.000 |    **0.917** |       0.469 | **0.964** |  **0.910** |
| `heading-80`        |    109 | 1.000 |    **0.917** |       0.469 | **0.953** |  **0.909** |
| `heading-800-plain` |     70 | 0.969 |    **0.891** |       0.448 | **0.961** |  **0.890** |

**By kind of question** (nDCG@3; the number of questions of that kind in brackets, a question can have several kinds)

| Kind              | `heading-800` | `heading-80` | `heading-800-plain` |
| ----------------- | ------------: | -----------: | ------------------: |
| numeric (6)       |         0.977 |        0.977 |               0.977 |
| rule (11)         |         0.956 |        0.952 |               0.935 |
| proper noun (11)  |         0.926 |        0.952 |               0.905 |
| history (3)       |         0.983 |        0.903 |               0.937 |
| character (4)     |         0.905 |        0.940 |               0.905 |
| conflict (4)      |         0.928 |        0.785 |               0.868 |
| multi-section (6) |         0.878 |        0.889 |               0.833 |
| paraphrase (8)    |         0.820 |        0.787 |               0.786 |

**The similarity floor** (passages below it are dropped; the app uses 0.30). Top-1 similarity of the 32 questions with an answer: lowest 0.369, median 0.566, highest 0.722. Of the 4 questions without an answer: chocolate cake 0.174, football 0.143, "How many dragons live in the Cinderlands?" 0.445, "Who is the god of the sea?" 0.391. Same result for all three configurations at 0.30.

| Floor    | Questions without an answer silenced (of 4) | Questions with an answer silenced (of 32) |
| -------- | ------------------------------------------: | ----------------------------------------: |
| **0.30** |                                       **2** |                                     **0** |
| 0.35     |                                           2 |                                         0 |
| 0.40     |                                           3 |                                         2 |
| 0.45     |                                           4 |                                         3 |
| 0.50     |                                           4 |                                         9 |

**Retrieval latency, 180 searches per run (milliseconds)**

| Run                                                           | Embedding p50 / p95 | Search p50 / p95 | **Total p50 / p95** | Total mean / max |
| ------------------------------------------------------------- | ------------------: | ---------------: | ------------------: | ---------------: |
| `heading-800`, as the app does                                |           300 / 383 |          53 / 58 |       **352 / 431** |        369 / 850 |
| `heading-80`, as the app does                                 |           289 / 360 |          54 / 62 |           343 / 413 |        360 / 861 |
| `heading-800`, diagnostic: query vector rounded to 4 decimals |           308 / 476 |           7 / 14 |           318 / 486 |        337 / 658 |

No search failed in any run. The median total by round for `heading-800` was 349, 350, 358, 350 and 363 ms: asking the same questions again is not faster, so no cache is helping.

**Ingestion cost and index size** (first ingest into an empty database; the same Lore Bible)

| Configuration       | Chunks | Tokens billed | Cost at list price | Time to ingest | Table, total |  Heap | Vectors and text (TOAST) | B-tree indexes |
| ------------------- | -----: | ------------: | -----------------: | -------------: | -----------: | ----: | -----------------------: | -------------: |
| `heading-800`       |     70 |         6,118 |          $0.000122 |          2.9 s |       536 kB | 48 kB |                   416 kB |          48 kB |
| `heading-80`        |    109 |         6,851 |          $0.000137 |          3.2 s |       776 kB | 64 kB |                   624 kB |          64 kB |
| `heading-800-plain` |     70 |         5,283 |          $0.000106 |          2.4 s |       536 kB | 48 kB |                   416 kB |          48 kB |

Each vector has 1024 numbers and takes 4,100 bytes as stored. The list price is USD 0.02 per million tokens, and the provider's free allowance covers it. A second ingest of unchanged lore billed 0 tokens (tested earlier).

### Key findings

- **All three configurations find the right section in the top 3 for almost every question.** With `heading-800`, every one of the 32 answerable questions has a relevant section in the top 3 (hit rate 1.00), recall@3 is 0.92, MRR 0.96 and nDCG@3 0.91.
- **Chunk size made no measurable difference.** `heading-80` has the same recall@3 (0.917) and nearly the same nDCG@3 (0.909 against 0.910). It moves single questions in both directions: small chunks cut an answer in two for "Can fire magic be cast inside the Ice Citadel?" and "Who founded the Ice Citadel, and when?", and helped for "What does it mean to be mana-blind?", "What is a Tide-key?" and "Who keeps the map of the lower galleries?". It costs 56% more chunks, 12% more tokens and 45% more storage, so `heading-800` stays the default.
- **The heading prefix helps a little.** Without it, recall@3 falls from 0.917 to 0.891 and nDCG@3 from 0.910 to 0.890, and one question, "What stops me from teleporting into a fortress?", has no relevant section in its top 3. It saves 14% of the tokens. The difference is the size of one or two questions, so it is a suggestion, not a proof.
- **Paraphrases and questions that need several passages are the weak spots** (nDCG@3 0.82 and 0.88 with `heading-800`). "What stops me from teleporting into a fortress?" finds only 1 of its 3 relevant sections in the top 3 in every configuration. Numbers and named things are easy (nDCG@3 0.93 to 0.98).
- **The similarity floor only silences off-topic questions.** Chocolate cake and football score 0.14 to 0.17, far below the floor. The two unanswerable questions that name real places or ideas of the lore score 0.39 and 0.45, in the range of real questions (the weakest real question scores 0.37). A higher floor does not fix it: 0.45 silences all four but also 3 of the 32 real questions, and 0.50 silences 9. The floor of 0.30 loses no real question, which is why it stays, but it cannot make the search say "nothing" for an unanswerable question that mentions real names. In a manual check with the real chat (2 questions, the development model), the assistant said that the lore does not cover them, from the weak passages it received.
- **Retrieval takes about 0.35 s (p50) and 0.43 s (p95).** The embedding request is about 85% of it (300 ms of 352 ms). Against the 8 s budget for a full answer, retrieval uses about 5% at p95.
- **The database search is cheap, but a large query parameter was not.** As the app sends it, the search takes 53 ms here. The database itself runs the query in about 1 ms. Sending the question's vector as text takes about 20 KB; rounding it to 4 decimals (7.5 KB) cuts the search to 7 ms and the total p50 from 352 to 318 ms. The extra 45 ms looks like a delay in the connection between Windows and Docker, not work done by Postgres, so it may not exist on a hosted database. Not changed in the app, and the effect on ranking of rounding was not evaluated.
- **Indexing the whole lore costs almost nothing:** about 6,100 tokens (USD 0.00012) and about 0.5 MB per configuration, most of it the vectors. There is no vector index; the 48 kB of indexes are B-trees for the world filter and the primary key.
- **Repeatable.** Two runs of each quality evaluation gave byte-identical results, and so did the token counts and sizes of two ingests.

### Caveats

- **The eval set is small and was written by one person.** Thirty-two questions with an answer: one question moves a mean by about 3 points, so the differences between configurations (0.917 against 0.891) are within what one or two questions can cause. Labels are whole sections, so scoring cannot see whether only a part of a section answers the question. The set was not blind: eight earlier questions had been tried on the search, and some topics overlap.
- **The same set was used to compare and to choose,** with only three configurations, so overfitting is unlikely but not excluded.
- **Latency is for this laptop.** The embedding time includes the internet path from here to Voyage's servers, and the search time includes the Windows to Docker connection. The hosted app was measured separately (Day 3: the search tool on Production), as a whole tool call, so the split between embedding and search (85% and the 45 ms effect) is only known for the laptop. The first calls (connection set-up) are excluded.
- **The latency figures leave out the chat route, the tools' other work and the model.** They are the search only.
- **The sizes are for fresh databases** with 70 to 109 rows. A hosted database may report slightly different totals.
- **Hybrid search and a reranker were not built,** so they are not measured. A chunking strategy that ignores headings (fixed-size) is not implemented, so it is not compared.
- **MRR looks 10 chunks deep,** the others look at the top 3. The cost is the list price of the provider, not necessarily what is billed.

### Reproduce

```sh
# 1. A Postgres with pgvector, and an empty database for each configuration
docker compose up -d postgres
docker compose exec postgres psql -U loreweaver -d postgres -c "create database measure_800"
docker compose exec postgres psql -U loreweaver -d postgres -c "create database measure_80"
docker compose exec postgres psql -U loreweaver -d postgres -c "create database measure_plain"

# 2. For each configuration: migrate, ingest (prints tokens and cost), score, time
#    (shown for heading-800; use measure_80 / heading-80 and measure_plain / heading-800-plain)
export DATABASE_URL=postgresql://loreweaver:loreweaver@localhost:5432/measure_800
pnpm --filter web db:migrate
pnpm ingest --config heading-800
pnpm eval:retrieval --config heading-800            # add --verbose for one line per question
pnpm measure:retrieval                              # MEASURE_CONFIG=heading-80 for another configuration
MEASURE_VECTOR_DECIMALS=4 pnpm measure:retrieval    # the diagnostic run

# 3. Table size
docker compose exec postgres psql -U loreweaver -d measure_800 -c "select pg_total_relation_size('lore_chunks'), pg_relation_size('lore_chunks'), pg_indexes_size('lore_chunks')"

# 4. Clean up
docker compose exec postgres psql -U loreweaver -d postgres -c "drop database measure_800"
```

On Windows PowerShell, set the variables first and remove them at the end:

```powershell
$env:DATABASE_URL = "postgresql://loreweaver:loreweaver@localhost:5432/measure_800"
pnpm --filter web db:migrate
pnpm ingest --config heading-800
pnpm eval:retrieval --config heading-800
pnpm measure:retrieval
$env:MEASURE_VECTOR_DECIMALS = "4"; pnpm measure:retrieval; Remove-Item Env:MEASURE_VECTOR_DECIMALS
Remove-Item Env:DATABASE_URL
```

The runs need `VOYAGE_API_KEY` and `EMBEDDING_MODEL` in `apps/web/.env.local`. All together they use about 25,000 tokens (a few thousandths of a cent). To time a hosted database instead, set `DATABASE_URL` to its connection string for the `measure:retrieval` command.

**To reproduce the recorded numbers exactly,** check out commit `cb1f815` first (`git checkout cb1f815`). The measured code has not changed since: only a comment in `search.ts` and documentation did. The quality figures, the token counts and the sizes are deterministic: repeated runs gave identical results. The latency depends on the machine and the network, so a new run gives close numbers, not identical ones.

## Day 3: the search tool on Production

**What was measured:** how long the chat's `search_lore` tool takes on the deployed app, with its hosted database and the real embedding service, seen from the outside: the time between the model calling the tool and the tool's result arriving in the stream. This is the whole search as the app runs it. The model is only used to decide to call the tool. Script: `apps/web/scripts/measure-search-tool.ts`.

### Setup (search tool)

| Item           | Value                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script version | Commit `51a459b`                                                                                                                                                                |
| Local          | The dev server on the laptop, the Docker Postgres, the dev model (Haiku 4.5). 20 questions                                                                                      |
| Production     | `https://loreweaver-nine.vercel.app`, which reported commit `05adb54`: Vercel, the hosted Supabase database, Sonnet 5.5. Two batches of 20 questions, asked one after the other |
| Questions      | The first 20 lore questions of the retrieval eval set (all in the Aethel world), one at a time, each in its world. The model decides whether to search and with which words     |
| Timing         | By the client. Events that arrive in the same network read share a time, and each of the two events adds a few milliseconds of network, so the tool time is slightly overstated |

### Results (search tool)

In milliseconds:

| Target              | Tool calls | **Tool time p50** | **Tool time p95** | Mean | Min / max  | Whole question p50 / p95 |
| ------------------- | ---------: | ----------------: | ----------------: | ---: | ---------- | -----------------------: |
| Local               |         20 |           **357** |           **948** |  479 | 323 / 1090 |              2869 / 4328 |
| Production, batch 1 |         20 |           **289** |           **707** |  428 | 215 / 800  |              4232 / 7275 |
| Production, batch 2 |         20 |           **287** |           **681** |  410 | 225 / 704  |              3994 / 5668 |

On Production all 40 tool calls succeeded and returned passages. The model searched for every question on Production, and for 19 of 20 locally (one question was answered without a search). "Whole question" is the time for the complete answer, with the model included: one search and two model steps.

### Key findings (search tool)

- **A search takes about 0.29 s at p50 on Production, and about 0.7 s at p95.** That is a little faster than on the laptop (0.36 s locally through the app, the same as the 0.35 s measured directly in the Day 3 lore retrieval entry, so the method agrees). The embedding request from the cloud is probably quicker than from the laptop, but this measurement cannot separate the parts.
- **About one search in ten is slower** (0.6 to 0.8 s, against 0.22 to 0.3 s for the rest). A likely cause is a new connection to the database when a serverless function starts, but this was not checked.
- **The lore is in the hosted database and works end to end:** no failure and no empty result in 40 calls.
- **The search is about 7% of a lore answer's time.** A whole question takes about 4.0 to 4.2 s at p50 and 5.7 to 7.3 s at p95, mostly the two model steps. That is inside the 8 s target, but the first batch left under 1 s of margin, with no character lookup and no reflection step yet.
- **The 50 ms effect of the large query parameter (Day 3 lore retrieval entry) cannot be seen here.** The whole hosted tool is faster than the laptop's embedding plus search, so the effect does not dominate on Production, but this does not show whether it exists there.

### Caveats (search tool)

- 20 questions per batch: the p95 is the second slowest call. The two Production batches agree on the median (289 and 287 ms) and on the p95 within about 4%, but the whole-question p95 differs by 1.6 s between them.
- The tool time includes the tool's own work (embedding, query, building the result) and two stream events over the network. It is not the database time alone.
- Cold starts were not isolated. The 10 minutes between batches may or may not have kept the function warm.
- Questions were all in one world, and the model chose the search words, so they differ from the fixed words of the Day 3 lore retrieval entry.
- Production runs Sonnet and local runs Haiku, which only affects the whole-question time, not the tool time.
- A Production run costs about 1 cent per question (about 40 cents for the 40 questions); the local run costs a fraction of that. The cost was estimated from token prices, not read from the console.

### Reproduce (search tool)

```sh
pnpm dev                                                       # terminal 1 (the CMS is not needed: no character tool is used)
pnpm measure:search-tool                                       # terminal 2: the local app
MEASURE_URL=https://loreweaver-nine.vercel.app MEASURE_REQUESTS=20 pnpm measure:search-tool   # a deployed app
```

On Windows PowerShell:

```powershell
pnpm measure:search-tool
$env:MEASURE_URL = "https://loreweaver-nine.vercel.app"; $env:MEASURE_REQUESTS = "20"
pnpm measure:search-tool
Remove-Item Env:MEASURE_URL, Env:MEASURE_REQUESTS
```

`MEASURE_REQUESTS` sets the number of questions (default 20). The target app needs the lore ingested in its database. **To reproduce the recorded numbers exactly,** check out commit `51a459b` for the script; the Production numbers describe the deployed version `05adb54` (as reported by `/api/health`), so a later deploy gives different numbers.
