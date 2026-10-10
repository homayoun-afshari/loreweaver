/**
 * Retrieval eval: measures the search ON ITS OWN, with no model writing an answer. For every
 * query of evals/retrieval.jsonl it embeds the question, asks the database for the nearest
 * chunks of that query's world (the same query the chat uses), and scores the ranking against
 * the labeled sections.
 *
 *   pnpm eval:retrieval                          default chunking configuration, k = 3
 *   pnpm eval:retrieval --config heading-80      another stored configuration (see pnpm ingest)
 *   pnpm eval:retrieval --k 5                    the top 5 instead of the top 3
 *   pnpm eval:retrieval --verbose                one line per query: what was found, and where
 *   pnpm eval:retrieval --json                   the whole result as JSON, for other tools
 *
 * It reads the database in DATABASE_URL (the local container by default) and needs the lore to
 * be ingested for the configuration it measures. It costs one embedding request of about 40
 * short questions: a fraction of a cent.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createStandaloneDb } from "../apps/web/src/db/standalone";
import { parseIngestEnv } from "../apps/web/src/lib/env";
import {
  CHUNK_CONFIGS,
  type ChunkConfigName,
  DEFAULT_CHUNK_CONFIG,
  HEADING_SEPARATOR,
} from "../apps/web/src/lib/rag/chunking";
import { embedTexts } from "../apps/web/src/lib/rag/embeddings";
import { loadLoreFiles } from "../apps/web/src/lib/rag/lore-files";
import { findNearestChunks, MIN_SIMILARITY } from "../apps/web/src/lib/rag/search";
import {
  corpusSectionKeys,
  findBrokenLabels,
  parseDataset,
  type QueryCase,
  relevantGrades,
} from "./retrieval-dataset";
import {
  isAbstention,
  meanScore,
  meanScoreByTag,
  type QueryScore,
  scoreRanking,
  sectionKey,
} from "./retrieval-metrics";

const DATASET = fileURLToPath(new URL("./retrieval.jsonl", import.meta.url));
const LORE_ROOT = fileURLToPath(new URL("../data/lore/", import.meta.url));
/** How many chunks are retrieved per query. The reciprocal rank (MRR) looks this deep. */
const DEPTH = 10;

const { values } = parseArgs({
  options: {
    config: { type: "string", default: DEFAULT_CHUNK_CONFIG },
    k: { type: "string", default: "3" },
    verbose: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

function readConfig(): ChunkConfigName {
  const names = Object.keys(CHUNK_CONFIGS) as ChunkConfigName[];
  if (!names.includes(values.config as ChunkConfigName)) {
    throw new Error(`Unknown --config "${values.config}". Use one of: ${names.join(", ")}.`);
  }
  return values.config as ChunkConfigName;
}

function readK(): number {
  const k = Number(values.k);
  if (!Number.isInteger(k) || k < 1 || k > DEPTH)
    throw new Error(`--k must be a whole number from 1 to ${DEPTH}.`);
  return k;
}

type QueryResult = {
  id: string;
  query: string;
  world: string;
  tags: readonly string[];
  /** Undefined for a query the lore cannot answer. */
  score?: QueryScore;
  topSimilarity?: number;
  /** The top k retrieved chunks, with the grade of their section (0 if not relevant). */
  top: { heading: string; similarity: number; grade: number }[];
};

const f = (n: number) => n.toFixed(3);

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the real environment.
  }
  const config = readConfig();
  const k = readK();

  // 1. The eval set, checked against the lore: a label that points nowhere would quietly lower the scores.
  const cases = parseDataset(await readFile(DATASET, "utf8"));
  const corpus = corpusSectionKeys(await loadLoreFiles(LORE_ROOT), CHUNK_CONFIGS["heading-800"]);
  const broken = findBrokenLabels(cases, corpus);
  if (broken.length > 0)
    throw new Error(`The eval set has labels that point nowhere:\n  - ${broken.join("\n  - ")}`);

  // 2. One request embeds every question (as questions, with the same model as the chunks).
  const env = parseIngestEnv(process.env);
  const embedded = await embedTexts(
    cases.map((c) => c.query),
    { apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL, inputType: "query" },
  );

  // 3. Retrieve and score.
  const { db, close } = createStandaloneDb(env.DATABASE_URL);
  const results: QueryResult[] = [];
  try {
    for (const [i, c] of cases.entries()) {
      const rows = await findNearestChunks(db, {
        worldId: c.world,
        chunking: config,
        embedding: embedded.vectors[i],
        limit: DEPTH,
      });
      if (rows.length === 0) {
        throw new Error(
          `No chunks of "${config}" for ${c.world}. Run: pnpm ingest --config ${config}`,
        );
      }
      results.push(scoreCase(c, rows, k));
    }
  } finally {
    await close();
  }

  report(results, { config, k, model: env.EMBEDDING_MODEL, queryTokens: embedded.totalTokens });
}

function scoreCase(
  c: QueryCase,
  rows: Awaited<ReturnType<typeof findNearestChunks>>,
  k: number,
): QueryResult {
  const grades = relevantGrades(c);
  const keys = rows.map((row) => sectionKey(row.sourcePath, row.headingPath));
  return {
    id: c.id,
    query: c.query,
    world: c.world,
    tags: c.tags,
    score: grades.size > 0 ? scoreRanking(keys, grades, k) : undefined,
    topSimilarity: rows[0]?.similarity,
    top: rows.slice(0, k).map((row, i) => ({
      heading: row.headingPath.split(HEADING_SEPARATOR).slice(-2).join(HEADING_SEPARATOR),
      similarity: row.similarity,
      grade: grades.get(keys[i]) ?? 0,
    })),
  };
}

function report(
  results: QueryResult[],
  meta: { config: string; k: number; model: string; queryTokens: number },
) {
  const answered = results.filter((r) => r.score);
  const negatives = results.filter((r) => !r.score);
  const overall = meanScore(answered.map((r) => r.score!))!;
  const byTag = meanScoreByTag(answered.map((r) => ({ tags: r.tags, score: r.score! })));

  // How the similarity floor of the search behaves on this set.
  const correctlyEmpty = negatives.filter((r) =>
    isAbstention(r.topSimilarity, MIN_SIMILARITY),
  ).length;
  const wronglyEmpty = answered.filter((r) => isAbstention(r.topSimilarity, MIN_SIMILARITY)).length;

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          ...meta,
          depth: DEPTH,
          floor: MIN_SIMILARITY,
          queries: results.length,
          answered: answered.length,
          overall,
          byTag,
          floorCheck: {
            negatives: negatives.length,
            correctlyEmpty,
            answered: answered.length,
            wronglyEmpty,
          },
          results,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Retrieval eval: ${results.length} queries (${answered.length} with answers, ${negatives.length} without), ` +
      `chunking ${meta.config}, top ${meta.k}, model ${meta.model}`,
  );
  const header = `${"".padEnd(18)} n   hit@${meta.k}  recall@${meta.k}  precision@${meta.k}   MRR     nDCG@${meta.k}`;
  const row = (label: string, n: number, s: QueryScore) =>
    `${label.padEnd(18)} ${String(n).padEnd(3)} ${f(s.hit)}  ${f(s.recall)}     ${f(s.precision)}        ${f(s.reciprocalRank)}   ${f(s.ndcg)}`;
  console.log(`\n${header}`);
  console.log(row("all", answered.length, overall));
  for (const [tag, { count, mean }] of Object.entries(byTag))
    console.log(row(`  ${tag}`, count, mean));

  console.log(
    `\nSimilarity floor ${MIN_SIMILARITY}: ${correctlyEmpty}/${negatives.length} queries without an answer get nothing (good); ` +
      `${wronglyEmpty}/${answered.length} queries with an answer would get nothing (bad).`,
  );
  console.log(`(MRR looks ${DEPTH} chunks deep. Query embedding: ${meta.queryTokens} tokens.)`);

  if (values.verbose) {
    console.log("\nPer query (* = relevant, the number is its grade):");
    for (const r of results) {
      const found = r.top
        .map((t) => `${t.grade > 0 ? `*${t.grade} ` : ""}${t.heading} (${t.similarity.toFixed(2)})`)
        .join(" | ");
      const stats = r.score
        ? `rr ${f(r.score.reciprocalRank)} ndcg ${f(r.score.ndcg)}`
        : "no answer";
      console.log(`${r.id} [${r.world.replace("world_", "")}] ${r.query}\n    ${stats}: ${found}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
