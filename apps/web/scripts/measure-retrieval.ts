/**
 * Latency of the lore search: the time to embed a question, the time of the vector search, and
 * their sum. It uses the same two functions as the chat's `search_lore` tool (the Voyage client
 * and the nearest-chunks query, top 3), one question at a time, the way a chat asks.
 *
 *   MEASURE_ROUNDS   how many times the 36 eval questions are asked (default 5)
 *   MEASURE_WARMUP   calls made first and thrown away: connection set-up (default 3)
 *   MEASURE_CONFIG   the stored chunking configuration to search (default: the app's default)
 *   MEASURE_VECTOR_DECIMALS
 *                    a DIAGNOSTIC: round the question's vector to this many decimals before the
 *                    search (default: no rounding, which is what the app does). It shrinks the
 *                    query parameter from about 20 KB to about 7 KB, to see whether the size of
 *                    that parameter, and not the search, is what takes the time.
 *
 * The database is the one in DATABASE_URL, so the numbers describe that database and the network
 * path to it: pass the hosted connection string to measure the hosted one.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseDataset } from "../../../evals/retrieval-dataset";
import { createStandaloneDb } from "../src/db/standalone";
import { parseIngestEnv } from "../src/lib/env";
import { embedTexts } from "../src/lib/rag/embeddings";
import { findNearestChunks, DEFAULT_TOP_K } from "../src/lib/rag/search";
import { DEFAULT_CHUNKING } from "../src/lib/rag/constants";
import { mean, percentile } from "../src/lib/stats";

const DATASET = fileURLToPath(new URL("../../../evals/retrieval.jsonl", import.meta.url));

type Sample = { round: number; embed: number; search: number; total: number };

const ms = (n: number) => `${Math.round(n)} ms`;

function row(label: string, values: number[]) {
  return (
    `  ${label.padEnd(10)} n=${String(values.length).padEnd(4)} mean ${ms(mean(values)).padEnd(8)} ` +
    `p50 ${ms(percentile(values, 50)).padEnd(8)} p95 ${ms(percentile(values, 95)).padEnd(8)} ` +
    `max ${ms(Math.max(...values))}`
  );
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the real environment.
  }
  const rounds = Number(process.env.MEASURE_ROUNDS ?? 5);
  const warmup = Number(process.env.MEASURE_WARMUP ?? 3);
  const chunking = process.env.MEASURE_CONFIG ?? DEFAULT_CHUNKING;
  const decimals =
    process.env.MEASURE_VECTOR_DECIMALS === undefined
      ? undefined
      : Number(process.env.MEASURE_VECTOR_DECIMALS);

  const env = parseIngestEnv(process.env);
  const cases = parseDataset(await readFile(DATASET, "utf8"));
  const { db, close } = createStandaloneDb(env.DATABASE_URL);

  async function once(world: string, query: string): Promise<Omit<Sample, "round">> {
    const t0 = performance.now();
    const { vectors } = await embedTexts([query], {
      apiKey: env.VOYAGE_API_KEY,
      model: env.EMBEDDING_MODEL,
      inputType: "query",
    });
    const t1 = performance.now();
    const embedding =
      decimals === undefined ? vectors[0] : vectors[0].map((x) => Number(x.toFixed(decimals)));
    await findNearestChunks(db, {
      worldId: world,
      chunking,
      embedding,
      limit: DEFAULT_TOP_K,
    });
    const t2 = performance.now();
    return { embed: t1 - t0, search: t2 - t1, total: t2 - t0 };
  }

  const samples: Sample[] = [];
  let failures = 0;
  try {
    for (let i = 0; i < warmup; i++)
      await once(cases[i % cases.length].world, cases[i % cases.length].query);
    for (let round = 1; round <= rounds; round++) {
      for (const c of cases) {
        try {
          samples.push({ round, ...(await once(c.world, c.query)) });
        } catch (error) {
          failures += 1;
          console.error(`failed (${c.id}):`, error instanceof Error ? error.message : error);
        }
      }
    }
  } finally {
    await close();
  }

  console.log(
    `Retrieval latency: chunking ${chunking}, top ${DEFAULT_TOP_K}, ${cases.length} questions x ${rounds} rounds ` +
      `(${warmup} warm-up calls discarded), ${failures} failed` +
      (decimals === undefined ? "" : `, query vector rounded to ${decimals} decimals`),
  );
  console.log(
    row(
      "embed",
      samples.map((s) => s.embed),
    ),
  );
  console.log(
    row(
      "search",
      samples.map((s) => s.search),
    ),
  );
  console.log(
    row(
      "total",
      samples.map((s) => s.total),
    ),
  );

  // Does asking the same questions again get faster (a cache somewhere)? Compare round 1 with the rest.
  console.log("\nTotal by round (p50):");
  for (let round = 1; round <= rounds; round++) {
    const values = samples.filter((s) => s.round === round).map((s) => s.total);
    if (values.length > 0)
      console.log(`  round ${round}: ${ms(percentile(values, 50))} (n=${values.length})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
