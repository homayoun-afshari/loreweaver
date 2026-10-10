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

### What the numbers say

- **Latency matches the design.** A uniform delay of 200 to 1500 ms has a median near 850 ms and a 95th percentile near 1430 ms. The measured p50 (about 870 ms) and p95 (about 1470 ms) agree.
- **Error rate matches the design.** About 5% (4.6% to 5.0%) of raw calls fail. With only 100 samples the rate is noisy (about 5 failures, give or take 2), which is why the 500-request run is also reported.
- **Retries remove the visible failures.** Success went from about 95% raw to 100% in both runs. In theory, four tries that each fail 5% of the time all fail with probability 0.05^4, so about 99.9994% success is expected; none of the 600 calls failed.
- **The price of retries is small.** Only 4% to 7% extra HTTP calls, and about 50 to 100 ms more on average. The slowest single calls (2.6 to 3.1 s) are the ones that needed one or more retries.
- **Budget:** the PRD target is p95 under 8 s for a full answer. The CMS lookup alone uses about 1.5 s of it, so the language-model steps have roughly 6.5 s left. The state lookup is therefore a significant share of the latency budget.

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

## Day 2: mini model benchmark

**What was measured:** the same five prompts sent to two Claude models through the real `POST /api/chat` route, to choose the model for the agent node (see ADR-0002). The method (scope, full setup, metric definitions, the exact prompts, the scoring rubric and all answers) is in [BENCHMARK.md](BENCHMARK.md). This section has only the numbers, the caveats and the command that reproduces them.

### Setup (short)

Date 2026-10-10. Local dev server and the real Anthropic API. Models `claude-haiku-4-5` and `claude-sonnet-5-5`. 5 prompts, 1 run each, one at a time. The legacy CMS is not involved.

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

### What the numbers say

- **Sonnet 5.5 is better here, at a clear price.** Quality 4.6 vs 3.8, but TTFT is about 2x higher (1.35 s vs 0.67 s), total latency about 1.7x higher and cost about 4.2x higher per answer.
- **Most of the quality gap is instruction following, not facts.** Both models refused to invent the blacksmith's name (P3). Haiku broke the format limits more often (P5), gave generic factions (P4) and explained P2 less clearly.
- **Sonnet writes more.** About 2.2x the output tokens, even though the system prompt asks for concise answers. That, plus the higher price per token, is why the cost ratio is above the price ratio of 2x.
- **Decode speed is not the difference.** Sonnet streams at about 133 tokens/s vs 95 for Haiku. The latency gap comes from the longer start (TTFT) and the longer answers.
- **Budget check:** the PRD target is p95 under 8 s for a full answer, and the legacy CMS lookup already uses about 1.5 s of it (Day 1). A single Sonnet answer took up to 6.3 s (P1), so a multi-step agent on Sonnet will be tight.
- **Absolute cost is tiny:** about $0.0008 (Haiku) and $0.0036 (Sonnet) per answer at these lengths.

### Caveats

- Five prompts and one run each: a trend, not a precise measurement. An earlier run (with a script bug that lost the token counts) gave TTFT within about 10% of this one.
- Quality scores come from one reader, with an AI assistant's help, an informal rubric and no blind scoring. The LLM judge arrives on Day 6.
- Run on a dev laptop: no Vercel network hop and no cold start, so Preview and Production TTFT will be somewhat higher.
- The legacy CMS and tools are not part of these numbers, so they describe the model alone, not a full agent answer.
- Part of the cost and latency gap is answer length (Sonnet wrote about 2.2x the tokens), not only model speed.
- The answers contain Markdown (`#` titles, `**bold**`) that the chat UI does not render yet.

### Reproduce

```sh
pnpm dev          # terminal 1 (needs ANTHROPIC_API_KEY in apps/web/.env.local)
pnpm benchmark    # terminal 2 (BENCHMARK_RUNS=3 repeats each prompt for steadier averages)
```

A run costs about two cents. The full answers go to `apps/web/scripts/.out/benchmark-latest.json` (git-ignored); the curated copy is in BENCHMARK.md.
