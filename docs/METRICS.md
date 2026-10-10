# Metrics

Every figure reported in the README is measured and recorded here, with how it was measured.

## Day 1: legacy CMS and legacy client

**What was measured:** how the legacy CMS behaves under its simulated flakiness (random 200 to 1500 ms delay, 5% `503`), and how well the web app's legacy client hides that flakiness.

### Setup

| Item       | Value                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-10-09                                                                                                        |
| Target     | Legacy CMS in Docker on the same laptop (`http://localhost:8080`), so network time is close to zero               |
| Rate limit | Raised from 30 to 100000 requests per minute for the run. Otherwise `429` would hide what is being measured       |
| Load       | 100 requests (baseline run) and 500 requests (for a steadier estimate); 4 at a time; characters 1 to 5 in turn    |
| Client     | Default settings: 2 s timeout, up to 3 retries, backoff 200 ms doubling (capped 2 s) with jitter, circuit breaker |
| Script     | `apps/web/scripts/measure-legacy.ts`                                                                              |

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
| Date         | 2026-10-10                                                                                                                             |
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

**To reproduce the recorded numbers exactly,** check out commit `414cddb` first (`git checkout 414cddb`). On the current code the same command also exercises the `fetch_character_state` tool and the longer prompt, so the answers, token counts and timings will differ.

## Day 2: chat with the tool (time to first UI)

**What was measured:** the question "What does Kael have on them?" sent through `POST /api/chat` with the `fetch_character_state` tool, timed the way a browser experiences the stream, plus the route's own timing. This is the full path: the model decides to call the tool, the CMS answers, the model writes one sentence. Script: `apps/web/scripts/measure-chat.ts`.

### Setup (chat)

| Item  | Value                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date  | 2026-10-10                                                                                                                                                                                      |
| Model | `claude-sonnet-5-5` in both targets (the Preview and Production model, ADR-0002)                                                                                                                |
| Local | Dev server and the Docker CMS on the same laptop. Sonnet is chosen with the local-only model override. 10 runs                                                                                  |
| Prod  | `https://loreweaver-nine.vercel.app` with the CMS on Cloud Run, deployed from the working tree with the Vercel CLI (the same code as the final-touch commit). 30 runs, client and server timing |
| Load  | One run at a time                                                                                                                                                                               |

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

`MEASURE_REQUESTS` sets the number of runs (default 10). Each run costs about one cent. Run it on the code of the commit that added `measure-chat.ts` or later.
