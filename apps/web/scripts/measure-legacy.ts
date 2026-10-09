/**
 * Day 1 load script: measures the legacy CMS and the web app's client in front of it.
 *
 *   Phase 1 (raw):    N direct HTTP calls -> latency p50/p95 and error rate of the CMS itself.
 *   Phase 2 (client): N calls through the legacy client (retries, timeout, circuit breaker)
 *                     -> success rate AFTER retries, and the cost of those retries.
 *
 * Run it against a CMS started WITHOUT the 30/min rate limit, otherwise 429s would hide
 * the thing being measured (see docs/METRICS.md for the exact command).
 */
import { createLegacyClient } from "../src/lib/legacy/client";
import { mean, percentile } from "../src/lib/stats";

const baseUrl = (process.env.LEGACY_CMS_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const apiKey = process.env.LEGACY_CMS_API_KEY ?? "dev-local-key";
const total = Number(process.env.MEASURE_REQUESTS ?? 100);
const concurrency = Number(process.env.MEASURE_CONCURRENCY ?? 4);
const characterIds = [1, 2, 3, 4, 5];

/** Runs `task(i)` for i in 0..count-1, at most `limit` at a time. */
async function runPool<T>(count: number, limit: number, task: (i: number) => Promise<T>) {
  const results: T[] = new Array(count);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, count) }, async () => {
      while (next < count) {
        const i = next++;
        results[i] = await task(i);
      }
    }),
  );
  return results;
}

const ms = (n: number) => `${Math.round(n)} ms`;
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
const idFor = (i: number) => characterIds[i % characterIds.length];

async function measureRaw() {
  const samples = await runPool(total, concurrency, async (i) => {
    const start = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${baseUrl}/v1/characters/${idFor(i)}/state`, {
        headers: { "X-API-Key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = 0; // network error or timeout
    }
    return { status, latency: performance.now() - start };
  });

  const latencies = samples.map((s) => s.latency);
  const byStatus: Record<string, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const errors = samples.filter((s) => s.status !== 200).length;

  console.log(`\nPhase 1: raw CMS (${total} requests, concurrency ${concurrency})`);
  console.log(`  status codes:  ${JSON.stringify(byStatus)}`);
  console.log(`  error rate:    ${pct(errors, total)} (${errors} of ${total} not 200)`);
  console.log(`  latency mean:  ${ms(mean(latencies))}`);
  console.log(`  latency p50:   ${ms(percentile(latencies, 50))}`);
  console.log(`  latency p95:   ${ms(percentile(latencies, 95))}`);
  console.log(`  latency max:   ${ms(Math.max(...latencies))}`);
}

async function measureClient() {
  // Count real HTTP attempts, to see how many extra calls the retries cost.
  let attempts = 0;
  const countingFetch: typeof fetch = (input, init) => {
    attempts += 1;
    return fetch(input, init);
  };
  const client = createLegacyClient({ baseUrl, apiKey, fetch: countingFetch });

  const samples = await runPool(total, concurrency, async (i) => {
    const start = performance.now();
    const result = await client.getCharacterState(idFor(i));
    return { result, latency: performance.now() - start };
  });

  const latencies = samples.map((s) => s.latency);
  const failures = samples.filter((s) => !s.result.ok);
  const kinds: Record<string, number> = {};
  for (const f of failures) {
    if (!f.result.ok) {
      const e = f.result.error;
      const key = e.kind === "unavailable" ? `unavailable/${e.reason}` : e.kind;
      kinds[key] = (kinds[key] ?? 0) + 1;
    }
  }

  console.log(`\nPhase 2: legacy client with retries (${total} calls, concurrency ${concurrency})`);
  console.log(
    `  success rate:  ${pct(total - failures.length, total)} (${total - failures.length} of ${total})`,
  );
  if (failures.length > 0) console.log(`  failures:      ${JSON.stringify(kinds)}`);
  console.log(`  HTTP attempts: ${attempts} (${(attempts / total).toFixed(2)} per call)`);
  console.log(`  latency mean:  ${ms(mean(latencies))}`);
  console.log(`  latency p50:   ${ms(percentile(latencies, 50))}`);
  console.log(`  latency p95:   ${ms(percentile(latencies, 95))}`);
  console.log(`  latency max:   ${ms(Math.max(...latencies))}`);
}

async function main() {
  console.log(`Target: ${baseUrl}`);
  await measureRaw();
  await measureClient();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
