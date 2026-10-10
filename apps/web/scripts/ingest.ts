/**
 * Ingestion: turns the Lore Bible (data/lore/<world>/*.md) into searchable rows in `lore_chunks`.
 *
 *   pnpm ingest                         the default chunking configuration, every world
 *   pnpm ingest --world world_aethel    only that world (repeat the flag for more)
 *   pnpm ingest --config heading-300    another configuration; "all" runs every configuration
 *   pnpm ingest --dry-run               chunk only: print sizes, touch no database, call no API
 *
 * It is idempotent: a second run on unchanged files embeds nothing, writes nothing, and costs
 * nothing. Only chunks whose text changed are embedded again. The database it writes to is the
 * one in DATABASE_URL (local Docker by default; pass the Supabase URL to target the cloud).
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loreChunks } from "../src/db/schema";
import { parseIngestEnv } from "../src/lib/env";
import { CHUNK_CONFIGS, type ChunkConfigName, DEFAULT_CHUNK_CONFIG } from "../src/lib/rag/chunking";
import { embedTexts, embeddingCostUsd } from "../src/lib/rag/embeddings";
import {
  buildDesiredChunks,
  type DesiredChunk,
  planIngest,
  withEmbeddings,
} from "../src/lib/rag/ingest-plan";
import { loadLoreFiles } from "../src/lib/rag/lore-files";

const LORE_ROOT = fileURLToPath(new URL("../../../data/lore/", import.meta.url));
const WRITE_BATCH = 50;

const { values } = parseArgs({
  options: {
    world: { type: "string", multiple: true },
    config: { type: "string", default: DEFAULT_CHUNK_CONFIG },
    "dry-run": { type: "boolean", default: false },
  },
});

function configNames(): ChunkConfigName[] {
  const all = Object.keys(CHUNK_CONFIGS) as ChunkConfigName[];
  if (values.config === "all") return all;
  if (!all.includes(values.config as ChunkConfigName)) {
    throw new Error(`Unknown --config "${values.config}". Use one of: ${all.join(", ")}, all.`);
  }
  return [values.config as ChunkConfigName];
}

/** Size statistics of a set of chunks, in estimated tokens. */
function sizeSummary(chunks: DesiredChunk[]) {
  const sizes = chunks.map((c) => c.tokenEstimate);
  const average = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
  return `${chunks.length} chunks, tokens min ${Math.min(...sizes)} / avg ${Math.round(average)} / max ${Math.max(...sizes)}`;
}

async function main() {
  const started = performance.now();
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local (for example in CI): rely on the real environment.
  }

  const files = await loadLoreFiles(LORE_ROOT, values.world);
  const worlds = [...new Set(files.map((f) => f.worldId))];
  const configs = configNames();
  console.log(`Lore: ${files.length} files in ${worlds.length} worlds (${worlds.join(", ")}).`);

  if (values["dry-run"]) {
    const model = process.env.EMBEDDING_MODEL ?? "dry-run";
    for (const name of configs) {
      for (const worldId of worlds) {
        const desired = buildDesiredChunks(
          files.filter((f) => f.worldId === worldId),
          name,
          CHUNK_CONFIGS[name],
          model,
        );
        console.log(`[dry run] ${name} / ${worldId}: ${sizeSummary(desired)}`);
      }
    }
    return;
  }

  const env = parseIngestEnv(process.env);
  // Same client settings as the app: Supabase's pooled connection has no prepared statements.
  const client = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
  const db = drizzle(client);
  let totalTokens = 0;

  try {
    for (const name of configNames()) {
      for (const worldId of worlds) {
        const desired = buildDesiredChunks(
          files.filter((f) => f.worldId === worldId),
          name,
          CHUNK_CONFIGS[name],
          env.EMBEDDING_MODEL,
        );
        const existing = await db
          .select({
            sourcePath: loreChunks.sourcePath,
            chunkIndex: loreChunks.chunkIndex,
            docType: loreChunks.docType,
            headingPath: loreChunks.headingPath,
            contentHash: loreChunks.contentHash,
            embedding: loreChunks.embedding,
          })
          .from(loreChunks)
          .where(and(eq(loreChunks.worldId, worldId), eq(loreChunks.chunking, name)));

        const plan = planIngest(desired, existing);

        let tokens = 0;
        let requests = 0;
        let embedded: { chunk: DesiredChunk; embedding: number[] }[] = [];
        if (plan.embed.length > 0) {
          const result = await embedTexts(
            plan.embed.map((chunk) => chunk.embeddedText),
            { apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL, inputType: "document" },
          );
          tokens = result.totalTokens;
          requests = result.requests;
          embedded = plan.embed.map((chunk, i) => ({ chunk, embedding: result.vectors[i] }));
        }
        const rows = withEmbeddings(plan, embedded);

        // One transaction: a failure halfway leaves the old rows exactly as they were.
        await db.transaction(async (tx) => {
          for (const gone of plan.remove) {
            await tx
              .delete(loreChunks)
              .where(
                and(
                  eq(loreChunks.worldId, worldId),
                  eq(loreChunks.chunking, name),
                  eq(loreChunks.sourcePath, gone.sourcePath),
                  eq(loreChunks.chunkIndex, gone.chunkIndex),
                ),
              );
          }
          for (let i = 0; i < rows.length; i += WRITE_BATCH) {
            await tx
              .insert(loreChunks)
              .values(
                rows.slice(i, i + WRITE_BATCH).map(({ chunk, embedding }) => ({
                  worldId: chunk.worldId,
                  chunking: chunk.chunking,
                  sourcePath: chunk.sourcePath,
                  chunkIndex: chunk.chunkIndex,
                  docType: chunk.docType,
                  headingPath: chunk.headingPath,
                  content: chunk.content,
                  contentHash: chunk.contentHash,
                  embedding,
                  embeddingModel: env.EMBEDDING_MODEL,
                  tokenEstimate: chunk.tokenEstimate,
                })),
              )
              .onConflictDoUpdate({
                target: [
                  loreChunks.worldId,
                  loreChunks.chunking,
                  loreChunks.sourcePath,
                  loreChunks.chunkIndex,
                ],
                set: {
                  docType: sql`excluded.doc_type`,
                  headingPath: sql`excluded.heading_path`,
                  content: sql`excluded.content`,
                  contentHash: sql`excluded.content_hash`,
                  embedding: sql`excluded.embedding`,
                  embeddingModel: sql`excluded.embedding_model`,
                  tokenEstimate: sql`excluded.token_estimate`,
                  updatedAt: sql`now()`,
                },
              });
          }
        });

        totalTokens += tokens;
        console.log(
          `${name} / ${worldId}: ${sizeSummary(desired)}\n` +
            `  kept ${plan.keep.length}, copied ${plan.copy.length}, embedded ${plan.embed.length}, ` +
            `removed ${plan.remove.length}; ${tokens} tokens in ${requests} request(s)`,
        );
      }
    }
  } finally {
    await client.end();
  }

  const cost = embeddingCostUsd(env.EMBEDDING_MODEL, totalTokens);
  console.log(
    `Done in ${((performance.now() - started) / 1000).toFixed(1)} s. ` +
      `Embedding tokens: ${totalTokens}. ` +
      (cost === undefined
        ? `Cost: unknown price for ${env.EMBEDDING_MODEL}.`
        : `Cost at list price: $${cost.toFixed(6)} (the free token allowance may cover it).`),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
