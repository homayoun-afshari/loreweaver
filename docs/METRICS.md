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
- One reader scored quality with an informal rubric, not blind. An LLM judge is planned for later.
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

## Day 4: the reflection loop

**What was measured:** what the reflection step does to the agent's answers, and what it costs. Ten questions about the seeded characters ([`evals/agent-prompts.json`](../evals/agent-prompts.json), seven of them written to tempt the agent into breaking a rule) were run through the agent graph, without a browser. The checker's verdicts say how often a **first draft** breaks a rule and how often the **final answer** still does, how many revisions that takes and how often a loop ends at a limit, and what checking and revising add to a query in time, tokens and money. The design is in [ADR-0004](adr/0004-orchestration-vs-ui-streaming.md) and [AGENT_DESIGN.md](AGENT_DESIGN.md).

### Setup

| Item         | Value                                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code version | Commit `2e56f88` (the graph, the stream, the measuring script, and the fix for empty drafts described in the findings)                                                                                                                                              |
| Target       | A laptop. The legacy CMS in Docker (its simulated delay of 200 to 1500 ms and 5% failures are part of the times), Postgres with the lore ingested (Day 3), the real Anthropic and Voyage APIs over the internet. No Vercel, no browser                              |
| Models       | Drafting `claude-sonnet-5-5` ($2 / $10 per million input / output tokens), the model of Preview and Production (ADR-0002). Checking `claude-haiku-4-5` ($1 / $5), temperature 0. Prompts `agent.v3` and `reflection.v2`                                             |
| Limits       | Up to 2 revisions (`AGENT_MAX_ITERATIONS`), 3 model calls per draft, no new revision after 12 s                                                                                                                                                                     |
| Load         | 10 prompts, 1 run each, one at a time. Seven tempt a rule break; three do not (`fire-escape-01`, a plain request; `restricted-stacks-04`, a conflict between the CMS and the lore; `what-carries-09`, state only)                                                   |
| Script       | `apps/web/scripts/measure-agent.ts`, run with `pnpm measure:agent`. The arithmetic is in `apps/web/src/lib/agent-metrics.ts`, which has unit tests. The raw record of every run (verdicts, answers, times, tokens) goes to `apps/web/scripts/.out/` (not committed) |

**Definitions.** A **violation** is a verdict of the reflection model with at least one reported rule. It is the checker's finding: the checker grades the pipeline it belongs to, so it is not proof of correctness, and it can be wrong in both directions. An **empty draft** (the model returned no text) and an **unavailable check** are not rule violations and are counted apart. The **first draft** is the first one that was checked; the **final answer** is what the author gets, and it counts as having a violation when the last check still reported one (the answer then carries a caveat). **Reflection overhead** is what checking and revising add: every reflection node run, plus the agent and tool work after the first check. Times are taken between the node updates of the graph, and each interval is given to the node that finished. **Cost** is tokens (as reported by the provider, thinking tokens included) times the list prices above; Voyage embeddings are not counted (a fraction of a cent).

### Results

**Rule violations found by the checker**

| Prompts           | First drafts | Final answers |
| ----------------- | -----------: | ------------: |
| All 10            |   20% (2/10) |    10% (1/10) |
| The 7 that tempt  |    14% (1/7) |      0% (0/7) |
| The 3 that do not |    33% (1/3) |     33% (1/3) |

**The loop**

| Metric                                   |    Value |
| ---------------------------------------- | -------: |
| Revisions per run, mean                  |     0.20 |
| Runs with a revision                     |  2 of 10 |
| Ended valid                              |        9 |
| Ended at the revision limit              |        0 |
| Ended at the time limit (12 s)           |        1 |
| Ended with the check unavailable         |        0 |
| Answers with a caveat                    |        1 |
| Empty first drafts / empty final answers |    0 / 0 |
| Runs that called every expected tool     | 10 of 10 |

**Per query**

| Metric                       |    mean |     p50 |     p95 |
| ---------------------------- | ------: | ------: | ------: |
| Total latency                |  10.6 s |   9.4 s |  20.0 s |
| Reflection overhead, latency |   2.7 s |   1.0 s |  10.5 s |
| of which checks              |   1.3 s |   1.0 s |   2.9 s |
| of which revisions           |   1.4 s |   0.0 s |   7.6 s |
| Cost of the run              | $0.0253 | $0.0201 | $0.0518 |
| Reflection overhead, cost    | $0.0076 | $0.0023 | $0.0314 |
| Answer length (words)        |     130 |     132 |     210 |

Overhead is 21% of the latency and 21% of the cost of a query (mean of the per-run shares). A check alone is about 1 s and about 2,500 input and 75 output tokens; a revision adds about 1,700 input and 120 output tokens of drafting. The first draft stage alone (the agent and the tools, before any check) took 7.9 s on average and cost $0.0177. The total spend of the run was $0.2528.

**Three full runs** (the same ten prompts, one after the other, to see how much the numbers move). Runs 1 and 2 are on commit `e2987d7`, before the fix for empty drafts; run 3 is the one above.

| Run |               Rule violations, first drafts | Final answers | Empty first drafts | Revisions, mean | Ended at the time limit | Latency mean / p95 | Cost, mean |
| --- | ------------------------------------------: | ------------: | -----------------: | --------------: | ----------------------: | -----------------: | ---------: |
| 1   | 4/10, empty drafts included (not separable) |          2/10 |      not separable |            0.30 |                       2 |      11.0 / 16.5 s |    $0.0257 |
| 2   |                                        3/10 |          1/10 |                  2 |            0.40 |                       1 |      11.6 / 17.6 s |    $0.0274 |
| 3   |                                        2/10 |          1/10 |                  0 |            0.20 |                       1 |      10.6 / 20.0 s |    $0.0253 |

### Key findings

- **The check catches real violations, and the revision usually fixes them.** The prompts that tempt had a rule violation in 1 to 2 of 7 first drafts (run 1: 3 of 7, with empty drafts counted in), and none or one in the final answers. Examples from the raw records: a draft that lit Kael's lantern inside the mine and used a rope and a pickaxe he does not carry (caught in all three runs); a draft that had Brannoc burn the door although he is mana-blind, has no mana and no flint (run 2). In all three runs the final answers to the tempting prompts had at most one violation left (0 of 7 in runs 2 and 3).
- **The value is in a few answers.** Two of ten queries needed a revision in the last run. The rest cost one check, about 1 s and $0.002 to $0.003. A revision adds about 5 to 8 s and, with it, the tail of the latency and the cost.
- **The checker also rejects good answers, always the same one.** `restricted-stacks-04` (the CMS says Sera holds a silver key, the lore says her records say she does not) was rejected on its first draft in all three runs, and ended with a caveat in all three, once after a revision. The draft was reporting the conflict honestly, which is what the prompt asks for; the checker called it a violation ("contradicting her current inventory") and once added "does not explain how" (an omission). That is the 33% (1/3) of plain prompts with a violation in the final answer: a **false rejection**, which `reflection.v2`'s instruction to ignore admitted limits and omissions did not prevent. It is a known limit; an independent judge and a larger set come later.
- **A defect was found and fixed by this measurement.** In runs 1 and 2, two prompts (`teleport-ward-03` and `old-price-08`) got an **empty first draft** from Sonnet 5.5: on the last model call of a draft, which has no tools, the model returned only a thinking block and ended its turn. Run 2's raw record shows it; run 1's was overwritten, so that it was the same cause is likely but not verified. The reflection step caught it ("the answer is empty") and the revision gave an answer, so the author never saw an empty reply, but it cost a revision each time. The last call now tells the model that no tools are left and to answer from what it has, and an empty draft is counted apart from rule violations. Run 3 had none.
- **Reflection is not what makes the answer slow.** Drafting alone (the agent and the tools, before any check) took 7.9 s on average, which is already at the PRD's 8 s budget (a p95 target) before reflection adds anything. **8 of 10 runs took longer than 8 s, and the slowest took 20.0 s**; the slowest and most expensive run is the one with a revision. Reflection adds 21% on average.
- **The guardrails of ADR-0002 are crossed.** Its revisit trigger is a p95 above 8 s or a cost per query above $0.05. The p95 latency was 16.5 to 20.0 s in the three runs, and one run in the last pass cost $0.0518. The mean cost per query ($0.0253) is half the budget. ADR-0002 should be revisited, and the levers (prompt caching, drafting time, the revision policy) are Day 5's work.
- **Loops are bounded as designed.** No run reached the revision limit; 1 to 2 of 10 ended at the 12 s time limit, which kept the longest run at 20.0 s, below the host's 30 s limit. Every expected tool was called in every run.

### Caveats

- **Ten prompts, one run each.** The p95 of 10 runs is the slowest run, and one prompt moves a rate by 10 points (14 points for the seven that tempt). The three runs differ by more than the effect of the fix for empty drafts, so read the rates as a range, not a point: first drafts with a rule violation 2 to 3 of 10, final answers 1 to 2 of 10.
- **The checker grades its own pipeline.** A violation is what the reflection model reported. A draft it accepts may still break a rule, and a draft it rejects may be fine (as the false rejection shows). The independent check is the judge planned for later.
- **The set was written before the runs and was not changed to improve a result,** but the prompt of the checker (`reflection.v2`) was tightened on Day 4 after live runs of a similar question (an escape from the Ice Citadel, which is not one of the ten), so the numbers are not from a fully blind check. The fix for empty drafts was made after runs 1 and 2 and measured in run 3.
- **A laptop, not the deployed app.** The CMS and the database are local (the CMS adds its simulated delay and failures), the model and embedding APIs are over the internet, and there is no Vercel hop or cold start. The times are the graph's, not the browser's, and the answer is not streamed token by token: it arrives in one piece after the check.
- **No prompt caching,** so every model call pays for the whole system prompt again; it is the first lever of Day 5.
- **Not covered:** a run that fails, the check being unavailable (it did not happen), a second turn of a conversation, and the other drafting model.
- Drafting tokens are as reported by the provider and include thinking tokens, which Sonnet 5.5 produces on some calls.

### Reproduce

```sh
docker compose up -d                                     # the CMS and Postgres, lore ingested (pnpm ingest)
pnpm measure:agent                                       # the ten prompts, one run each
MEASURE_RUNS=2 pnpm measure:agent                        # each prompt twice
MEASURE_ONLY=what-carries-09 pnpm measure:agent          # one prompt, to try it
MEASURE_MODEL=claude-haiku-4-5 pnpm measure:agent        # another drafting model
```

It needs `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` and the other settings in `apps/web/.env.local`. **A run of the ten prompts costs about $0.25 to $0.30** at list prices (the three runs above cost $0.2528 to $0.2738 each), and takes about 2 minutes.

**To reproduce the recorded numbers exactly,** check out commit `2e56f88` first (`git checkout 2e56f88`). The numbers are **not deterministic**: the models, the network and the CMS's random delay and failures change from run to run, as the three runs above show, so a new run gives close numbers, not identical ones. The measured code has not changed since: later commits changed only documents. Runs 1 and 2 were made on commit `e2987d7`, which differs from `2e56f88` only by the empty-draft fix (a note added to the last model call of a draft) and by counting empty drafts apart; the script in `e2987d7` had no final `process.exit`, which does not affect the numbers.

## Day 5: cost per query and monthly projection

**What was measured:** what one question costs the agent in tokens and dollars, by kind of token and by step, and what that means per month. The ten questions of [`evals/agent-prompts.json`](../evals/agent-prompts.json) were run through the agent graph without a browser, every run was traced in LangSmith, and the cost was worked out from the traces. This is the state **before prompt caching**, so that the optimization of the entry "prompt caching, before and after" has a "before". The cost and the latency per query are the PRD's guardrails ($0.05 and 8 s).

### Setup (cost)

| Item         | Value                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code version | The agent of tag `baseline-day5` (commit `5faa00f`). The runs were made one commit earlier, on `f39405b` (tracing), which has the same agent, prompts and models: the commit between the two only adds the cost report and the cache prices                           |
| Target       | A laptop. The legacy CMS in Docker (its simulated delay and failures are part of the times), Postgres with the lore ingested, the real Anthropic and Voyage APIs over the internet, traces sent to the LangSmith project `loreweaver-dev` (EU). No Vercel, no browser |
| Models       | Drafting `claude-sonnet-5-5`, checking `claude-haiku-4-5` at temperature 0. Prompts `agent.v3` and `reflection.v2`. Up to 2 revisions, 3 model calls per draft, no new revision after 12 s                                                                            |
| Load         | 10 prompts, 1 run each, one at a time, on 2026-10-11 between 17:58 and 18:01 UTC (the traces of that period)                                                                                                                                                          |
| Scripts      | `apps/web/scripts/measure-agent.ts` (`pnpm measure:agent`) runs the prompts. `evals/cost-report.ts` (`pnpm cost:report`) reads the traces back and works out the cost. The arithmetic is in `apps/web/src/lib/cost-metrics.ts`, with unit tests                       |

**Prices** (USD per million tokens, from the providers' pricing pages on 2026-10-11, kept in `apps/web/src/lib/ai/models.ts`):

| Model             | Input | Cache write (5 min) | Cache read | Output |
| ----------------- | ----: | ------------------: | ---------: | -----: |
| Claude Sonnet 5.5 |    $2 |               $2.50 |      $0.10 |    $10 |
| Claude Haiku 4.5  |    $1 |               $1.25 |      $0.10 |     $5 |

Embeddings (`voyage-4-lite`, $0.02 per million tokens, the first 200 million free) are not in the traces, and a search question of a few tokens costs far less than a millionth of a dollar, so they are left out.

**Definitions.** The **cost of a query** is the sum over its model calls of: input tokens that were not cached × the input price, tokens read from the cache × the cache-read price, tokens written to the cache × the cache-write price, and output tokens × the output price. Each call is priced by the model that made it. The provider counts every input token, cached ones included; the report takes the cached ones out and prices them apart. A **query** is one root trace: one question, from the start of the graph to the answer. The **monthly cost** is the cost per query × queries per author per day × 30 × active authors. **20 queries per author per day is an assumption**, not a measurement. The p95 of 10 runs is the slowest run.

### Results (cost)

**Per query**

| Metric |    mean |     p50 |     p95 |
| ------ | ------: | ------: | ------: |
| Cost   | $0.0241 | $0.0223 | $0.0384 |

**Tokens per query** (mean): 9,563 input (none cached), 780 output, in 4.3 model calls (the drafting calls and the checks; a query has one check, and one more for each revision).

**Where the money goes**

| By kind of token | Share of the cost |
| ---------------- | ----------------: |
| Input            |               69% |
| Output           |               31% |

| By step                          | Share of the cost |
| -------------------------------- | ----------------: |
| Agent (drafting, with revisions) |               88% |
| Reflect (the check)              |               12% |

**The queries** (in prompt order, with their number of model calls)

| Prompt                 | Calls |  Input | Output |    Cost |
| ---------------------- | ----: | -----: | -----: | ------: |
| `fire-escape-01`       |     4 |  9,180 |    882 | $0.0246 |
| `no-flint-02`          |     4 |  9,203 |    810 | $0.0240 |
| `teleport-ward-03`     |     4 |  8,953 |    681 | $0.0223 |
| `restricted-stacks-04` |     6 | 15,223 |  1,338 | $0.0384 |
| `mine-gear-05`         |     6 | 14,072 |  1,363 | $0.0367 |
| `heal-and-teleport-06` |     4 |  8,306 |    843 | $0.0228 |
| `other-world-07`       |     4 |  7,453 |    781 | $0.0210 |
| `old-price-08`         |     4 |  8,632 |    534 | $0.0203 |
| `what-carries-09`      |     3 |  5,347 |    138 | $0.0105 |
| `strike-flint-10`      |     4 |  9,264 |    426 | $0.0202 |

**Monthly cost** at 20 queries per author per day, 30 days:

| Active authors | At the mean cost ($0.0241) | At the p95 cost ($0.0384) |
| -------------: | -------------------------: | ------------------------: |
|            100 |                     $1,445 |                    $2,303 |
|          1,000 |                    $14,447 |                   $23,026 |
|         10,000 |                   $144,474 |                  $230,256 |

One author at the mean cost is about $14.45 a month. The total of the ten queries was $0.2408; the cost report and LangSmith's own cost for the same calls agree to the cent ($0.2408 and $0.2408).

### Key findings (cost)

- **A query costs $0.0241 on average, and the slowest, most expensive one $0.0384.** Both are inside the PRD's guardrail of $0.05 per query. (Day 4's measurement had one run above it, $0.0518; this run of the same prompts has none.)
- **Input, not output, is most of the cost.** 69% of the money is input tokens: a query makes about 4 model calls, and each one sends the whole conversation again (the tool definitions, the system prompt, the question and the tool results), 9,563 input tokens in all for 780 of output. This is why caching is the first lever to try.
- **The cost is in the drafting model.** The agent node is 88% of the cost and the check 12%.
- **The tail is the queries with a revision or an extra round.** The two queries with six model calls cost $0.0367 and $0.0384; the other eight cost between $0.0105 and $0.0246.
- **At 20 queries a day, one author costs about $14.45 a month, and 1,000 authors about $14,400.** The projection moves with the assumed use. It says that the price of a seat has to be set against a cost of that size, and that the levers (caching, a cheaper drafting model, fewer rounds) matter.

### Caveats (cost)

- **Ten prompts, one run each.** One prompt moves the mean by a tenth. The runs are not repeatable: the same prompt had a different path in Day 4's runs, and two of the ten needed a revision here.
- **20 queries per author per day is assumed.** No real use was measured.
- **List prices, not the bill.** The cost is tokens times the prices above. It was checked against LangSmith, which uses the same prices, so this checks the token counts and the arithmetic, not the invoice. It was not reconciled with the Anthropic Console.
- **A laptop with the CMS beside it.** The CMS adds its simulated delay and failures, which are in the times but not in the cost.
- **Traces are kept for 14 days** on the plan in use, so these traces can be read again only until 2026-10-25. After that, reproduce by running the prompts again.
- Embeddings are left out (see above).

### Reproduce (cost)

```sh
docker compose up -d                                  # the CMS and Postgres, lore ingested (pnpm ingest)
git checkout baseline-day5                            # the agent of the recorded runs
pnpm measure:agent                                    # the ten prompts, traced to LangSmith if the LANGSMITH_* variables are set
git checkout main                                     # the report reads any traces
pnpm cost:report --from <start UTC> --to <end UTC> --env development --model claude-sonnet-5-5 --prompt-version agent.v3 --verbose
```

For the recorded run the period is `--from 2026-10-11T17:58:00Z --to 2026-10-11T18:01:00Z`, for as long as the traces exist. `pnpm measure:agent` also prints the cost and the latency per query itself (at the commit of the baseline it prices tokens at list prices, which is the same for a run without caching). `pnpm cost:report` reads `apps/web/.env.local` (the LangSmith key, the EU address and the workspace id) and sends nothing to a model. **A run of the ten prompts costs about $0.24** at list prices and takes about 2 minutes.

**To reproduce the recorded numbers exactly,** check out `baseline-day5` first. The numbers are **not deterministic**: the models, the network and the CMS's random delay and failures change from run to run, so a new run gives close numbers, not identical ones. The agent has changed since: caching lowers the cost per query (see the caching entry below), and the usage limits add one database write per request. Checking out `baseline-day5` reproduces the figures before caching.

## Day 5: latency and time to first token through the graph

**What was measured:** how long a question takes from the start of the graph to its answer, and how long the author waits for the first word, now that every answer is checked before it is sent. The time to first token (TTFT) is compared with Day 2's, which was measured with the same script and setup before the agent had a check. Two measurements: the ten prompts (the latency of each trace) and the one-tool question "What does Kael have on them?" sent through `POST /api/chat` and timed the way a browser sees the stream.

### Setup (latency)

| Item         | Value                                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code version | The same agent as in the cost entry. The ten prompts: the runs of that entry. The chat question: commit `a78fb5f`, which has the agent of `baseline-day5` and the timing script that sends the world cookie of its question              |
| Target       | A laptop. Dev server and the Docker CMS on the same machine, Postgres with the lore, the real APIs. Drafting `claude-sonnet-5-5` chosen with the local-only model override, as on Day 2                                                  |
| Load         | The ten prompts: 1 run each. The chat question: 10 runs, one at a time, on 2026-10-11 around 18:53 UTC                                                                                                                                   |
| Scripts      | The latency of a trace comes from `pnpm cost:report`. TTFT, time to first UI and to the card come from `apps/web/scripts/measure-chat.ts` (`pnpm measure:chat`), which reads the response stream and also reports the route's own timing |

**Definitions.** The **latency of a query** is the time of its root trace, from the start of the graph to the answer (the route's validation and the network to a browser are not in it). **TTFT** is the time until the first text token reaches the client. Since the answer is held back until the check has passed, it is sent in one piece, so TTFT and the total time are almost the same. **Time to first UI** is when the browser can draw the card skeleton (the first tool call), and **time to card** when the tool result arrives. Client time starts when the request is sent; server time starts when the route starts.

### Results (latency)

**The ten prompts, latency per query** (mean 11.3 s)

| Metric             |   mean |    p50 |    p95 |
| ------------------ | -----: | -----: | -----: |
| End-to-end latency | 11.3 s | 10.4 s | 18.6 s |

**The chat question, Day 2 and Day 5** (client side, local)

| Metric                      | Day 2 p50 | Day 5 p50 | Day 2 p95 | Day 5 p95 |
| --------------------------- | --------: | --------: | --------: | --------: |
| Time to first UI (skeleton) |    761 ms |   1413 ms |   1608 ms |   3041 ms |
| Time to card                |   2092 ms |   2311 ms |   2673 ms |   3780 ms |
| TTFT                        |   3219 ms |   4302 ms |   3751 ms |   5715 ms |
| Total                       |   3225 ms |   4302 ms |   3758 ms |   5717 ms |

Day 5 mean TTFT 4325 ms. On the server side, TTFT was 4281 ms at the median and 4656 ms at the p95 (Day 2: 3038 ms and 3740 ms). All ten runs found the character and drew the card.

### Key findings (latency)

- **The first word comes about 1.1 s later than on Day 2** (TTFT p50 3.2 s to 4.3 s, p95 3.8 s to 5.7 s). The check takes about 1 s (Day 4's measurement: 1.0 s at the median), so the check explains almost all of it: the answer cannot start before it is verified. This is the cost of reflection that Day 4 predicted.
- **Streaming no longer shortens the wait.** TTFT and the total are within a few milliseconds of each other, because the text arrives once, after the check.
- **The skeleton and the card come later too** (first UI 0.76 s to 1.4 s, card 2.1 s to 2.3 s). The graph's nodes return when a whole model call has finished, so the first sign of a tool call arrives after the first model call and not as soon as the model starts it.
- **The PRD's p95 of 8 s is not met.** The ten prompts have a p95 of 18.6 s and a median of 10.4 s. Drafting is most of the time: in the traces, the drafting calls take about 2 to 3 s each and a query makes about three, the check about 1 s. A revision adds a whole drafting round (this is the 16.4 s and the 18.6 s of the two queries with six calls). The simple one-tool question is inside the target (p95 5.7 s).
- **The route and the network add little.** The latency of the trace (3.6 to 4.6 s for these ten runs) is close to the TTFT seen by the client.

### Caveats (latency)

- **Ten runs of one question, and ten prompts once.** The p95 of 10 runs is the slowest run. The p95 of the ten prompts depends on whether a revision lands in the sample (two of ten did).
- **One question that needs one tool.** The ten prompts need two tools and sometimes a revision; they were not timed through the route.
- **A laptop with the CMS beside it,** so the numbers have no Vercel hop, no cold start and no network to a browser. The CMS's simulated delay is part of the times.
- **An earlier attempt was discarded.** The first run of the timing script, with no world cookie, asked for a character of another world, got a refusal with no tool call and measured the refusal (about 2.6 s). The script now sends the cookie, and the run above is the second.
- The comparison with Day 2 is of the same script and question, but on different days, so the model's own speed may differ a little.

### Reproduce (latency)

```sh
docker compose up -d legacy-cms postgres
pnpm dev                                                          # terminal 1
MEASURE_MODEL=claude-sonnet-5-5 pnpm measure:chat                 # terminal 2: local, client and server timing
MEASURE_REQUESTS=30 pnpm measure:chat                             # more runs
```

For the ten prompts, see the cost entry. **A run of `pnpm measure:chat` costs about $0.10 at the prices of that commit.** **To reproduce the recorded numbers exactly,** check out `a78fb5f`. The numbers are not deterministic; a new run gives close numbers. Since that commit the agent gained caching and the usage limits; neither changed the time to first token in a way that the measurement can tell from noise (see the caching entry below).

## Day 5: prompt caching, before and after

**What was measured:** what caching the system prompt and the tool definitions of the drafting model changes. The same ten prompts and the same chat question were run again with caching on, and compared with the runs before it (the two entries above): cost per query, cache hit rate, time to first token and latency. Caching is the one optimization of the day.

### Setup (caching)

| Item         | Value                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code version | **Before:** as in the two entries above (`baseline-day5`, `a78fb5f`). **After:** commit `5187c84`, which adds a cache marker on the system prompt of the drafting calls that offer the tools, and the usage limits (the route also records each request in the database, a small write that was not timed apart)                         |
| Target       | The same laptop and setup as the entries above. Sonnet 5.5 is used because its minimum cacheable prompt is 512 tokens; the dev model, Haiku 4.5, needs 4,096 and the prefix is below it, so nothing would be cached                                                                                                                      |
| Load         | **After, ten prompts:** 1 run each, one at a time, on 2026-10-11 between 20:11 and 20:14 UTC. **After, chat question:** 10 runs, one at a time, 20:13:58 to 20:14:45 UTC, started straight after the prompts. The cache lives 5 minutes and the runs were seconds apart, so after the first query of a world nearly every call is a read |
| Scripts      | As above: `pnpm measure:agent`, `pnpm measure:chat` and `pnpm cost:report`                                                                                                                                                                                                                                                               |

**Definitions.** The **cache hit rate** is the share of all input tokens that were read from the cache (a write is not a hit). The **prefix** is the tool definitions and the system prompt, 1,843 tokens in the Aethel world and 1,830 in Nox (the system prompt lists the world's characters, so each world has its own cache entry). The last call of a draft has no tools and a note added to its prompt, so it does not start like the others and is not cached.

### Results (caching)

**The ten prompts, per query**

| Metric                                   |               Before |                After | Change |
| ---------------------------------------- | -------------------: | -------------------: | -----: |
| Cost, mean                               |              $0.0241 |              $0.0178 |   −26% |
| Cost, p50                                |              $0.0223 |              $0.0139 |   −38% |
| Cost, p95                                |              $0.0384 |              $0.0389 |    +1% |
| Input tokens, not cached (mean)          |                9,563 |                5,901 |        |
| Input tokens read from the cache (mean)  |                    0 |                3,865 |        |
| Input tokens written to the cache (mean) |                    0 |                  367 |        |
| Output tokens (mean)                     |                  780 |                  764 |        |
| Model calls (mean)                       |                  4.3 |                  4.4 |        |
| **Cache hit rate**                       |               **0%** |              **38%** |        |
| Latency, mean / p50 / p95                | 11.3 / 10.4 / 18.6 s | 12.2 / 10.8 / 22.5 s |        |

The total cost of the ten queries went from $0.2408 to $0.1778.

**Per prompt** (cost, with the number of model calls)

| Prompt                 |      Before |       After | Change |
| ---------------------- | ----------: | ----------: | -----: |
| `fire-escape-01`       | $0.0246 (4) | $0.0215 (4) |   −13% |
| `no-flint-02`          | $0.0240 (4) | $0.0176 (4) |   −27% |
| `teleport-ward-03`     | $0.0223 (4) | $0.0139 (4) |   −38% |
| `restricted-stacks-04` | $0.0384 (6) | $0.0389 (7) |    +1% |
| `mine-gear-05`         | $0.0367 (6) | $0.0286 (6) |   −22% |
| `heal-and-teleport-06` | $0.0228 (4) | $0.0149 (4) |   −35% |
| `other-world-07`       | $0.0210 (4) | $0.0135 (4) |   −36% |
| `old-price-08`         | $0.0203 (4) | $0.0124 (4) |   −39% |
| `what-carries-09`      | $0.0105 (3) | $0.0035 (3) |   −67% |
| `strike-flint-10`      | $0.0202 (4) | $0.0130 (4) |   −36% |

The first query (`fire-escape-01`) found the cache cold and wrote the prefix (1,843 tokens); `mine-gear-05` is in the world Nox and wrote that world's prefix (1,830 tokens).

**The chat question "What does Kael have on them?"** (10 runs, 3 model calls each)

| Metric                        |         Before |          After |    Change |
| ----------------------------- | -------------: | -------------: | --------: |
| Cost per query                |        $0.0103 |        $0.0033 |      −68% |
| Input tokens, not cached      |          5,279 |          1,620 |           |
| Input tokens read from cache  |              0 |          3,660 |           |
| **Cache hit rate**            |         **0%** |        **69%** |           |
| TTFT, client, p50 / p95       | 4302 / 5715 ms | 4067 / 5960 ms | −5% / +4% |
| TTFT, client, mean            |        4325 ms |        4461 ms |       +3% |
| Time to first UI, client, p50 |        1413 ms |        1444 ms |       +2% |
| Time to card, client, p50     |        2311 ms |        2136 ms |       −8% |
| Latency of the trace, p50     |          4.3 s |          4.0 s |           |

**Monthly cost** at 20 queries per author per day (the projection of the cost entry, with the new mean of $0.0178): 100 authors $1,067, 1,000 authors $10,670, 10,000 authors $106,696 (a quarter lower than before: $1,445, $14,447, $144,474). At the p95 cost ($0.0389) it is $2,335, $23,346 and $233,455.

**Where the money goes after caching:** input tokens 52%, output 40%, cache reads 2%, cache writes 5%; the agent node 83% and the check 17%.

### Key findings (caching)

- **Caching lowers the cost of a query by a quarter to a third.** The mean cost fell 26% ($0.0241 to $0.0178) and the median 38% ($0.0223 to $0.0139). On the nine prompts that made the same number of model calls in both runs, the mean fell 31% ($0.0225 to $0.0154). The saving is the cached prefix: about 3,865 tokens a query read at $0.10 instead of $2.00 per million, less the small cost of writes.
- **The p95 did not move** ($0.0384 to $0.0389). It is the same prompt in both runs (`restricted-stacks-04`), which had a revision, and this time one more model call (7 against 6). Caching cannot remove a round of drafting, so the tail of the cost is the revisions, not the repeated prefix.
- **The cache hit rate is 38% of the input tokens on the ten prompts and 69% on the one-tool question.** The rest of the input is what changes (the question, the tool results) and the last call of a draft, which has no tools and cannot read the cache. On a simple lookup, the cost fell by two thirds ($0.0103 to $0.0033).
- **Writes are rare and small.** A write happens once per world per five minutes, and costs the prefix at $2.50 per million instead of $2.00, about $0.0009 more than a plain query. Under sparse traffic (a question every few minutes) most queries would pay it and none would save.
- **The speed did not change in a way that can be measured.** TTFT p50 moved from 4302 ms to 4067 ms (−5%) and p95 from 5715 ms to 5960 ms (+4%); the ten prompts' latency went from 11.3 s to 12.2 s on average and from 18.6 s to 22.5 s at the p95, because two queries had more rounds. All of this is inside the spread that repeated runs of the same prompts show (Day 4: p95 from 16.5 s to 20.0 s). Caching mostly lowers the price, not the wait, here.
- **The check is not cached and its share of the cost grew** (12% to 17%). Its prompt, about 2,400 tokens, is below the 4,096 tokens that Haiku 4.5 needs.
- **After caching, input is still half of the cost** (52%), so the next levers are fewer rounds, a cheaper drafting model or smaller tool results, not more caching.

### Caveats (caching)

- **One run of each, ten prompts.** The before and after runs have different paths: the number of model calls differs for one prompt, and the two runs were made at different times of day. The mean saving (−26%) includes that noise; the per-prompt table shows the effect on prompts with the same path (−13% to −67%, −31% on the nine).
- **The cache was warm by design.** The runs were seconds apart. With sparse traffic the saving shrinks and a cold query costs a little more than before. The measurement does not cover a day of real use.
- **Sonnet 5.5 only, and only on a laptop and in one world at a time.** The dev model Haiku 4.5 is below its minimum and caches nothing. Vercel was checked for a write and a read on two queries, not measured.
- **The TTFT comparison is within noise.** Ten runs, the p95 is the slowest.
- **After the check of Day 4 the output is the same:** output tokens (780 and 764) did not change, so the caching did not change what the model writes. The answers were not compared one by one.

### Reproduce (caching)

```sh
docker compose up -d                                      # the CMS and Postgres, lore ingested
git checkout 5187c84                                      # the code with caching
pnpm measure:agent                                        # the ten prompts, traced
pnpm cost:report --from <start UTC> --to <end UTC> --env development --model claude-sonnet-5-5 --prompt-version agent.v3 --verbose
pnpm dev                                                  # terminal 1
MEASURE_MODEL=claude-sonnet-5-5 pnpm measure:chat         # terminal 2, straight after the prompts so that the cache is warm
```

For the recorded run the period of the ten prompts is `--from 2026-10-11T20:11:00Z --to 2026-10-11T20:14:00Z`, and of the chat question `--from 2026-10-11T20:13:50Z --to 2026-10-11T20:15:00Z`, for as long as the traces exist (until 2026-10-25). **The ten prompts cost $0.18 and the chat question about $0.03**, at the prices above. The measured code has not changed since: later commits change only documents.

**To reproduce the recorded numbers exactly,** check out `5187c84`. The numbers are **not deterministic** (the models, the network and the CMS's random delay and failures vary, and the cache state depends on the minutes between the runs), so a new run gives close numbers, not identical ones.
