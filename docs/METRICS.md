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
