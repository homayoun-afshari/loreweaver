import { and, eq } from "drizzle-orm";
import { createStandaloneDb } from "../apps/web/src/db/standalone";
import { loreChunks } from "../apps/web/src/db/schema";
import { CHUNK_CONFIGS, DEFAULT_CHUNK_CONFIG } from "../apps/web/src/lib/rag/chunking";
import { DEFAULT_CHUNKING } from "../apps/web/src/lib/rag/constants";
import { embedTexts } from "../apps/web/src/lib/rag/embeddings";
import { buildDesiredChunks } from "../apps/web/src/lib/rag/ingest-plan";
import { loadLoreFiles } from "../apps/web/src/lib/rag/lore-files";

/**
 * Test worlds for the red-team set: a folder `evals/fixtures/lore/<world>/` holds lore with an
 * instruction hidden in it. For the length of a run the folder is written to the database as if it
 * had been ingested, so the real search finds it, and it is removed at the end. The real worlds are
 * not touched, and nothing here ships: the files are not in `data/lore`.
 */

/** True for a database on this machine. The fixtures are written to no other. */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

export type FixtureWorld = { chunks: number; remove: () => Promise<void> };

/** Writes the fixture world to the local database (replacing any rows left by a crashed run). */
export async function loadFixtureWorld(args: {
  root: string;
  worldId: string;
  databaseUrl: string;
  voyageKey: string;
  embeddingModel: string;
}): Promise<FixtureWorld> {
  if (!isLocalDatabase(args.databaseUrl)) {
    throw new Error(
      "The red-team fixtures are written only to a database on this machine; DATABASE_URL points elsewhere.",
    );
  }
  const files = await loadLoreFiles(args.root, [args.worldId]);
  // The path in a citation: where the file really is, not the lore folder it imitates.
  const fixtureFiles = files.map((f) => ({
    ...f,
    sourcePath: f.sourcePath.replace("data/lore/", "evals/fixtures/lore/"),
  }));
  const desired = buildDesiredChunks(
    fixtureFiles,
    DEFAULT_CHUNKING,
    CHUNK_CONFIGS[DEFAULT_CHUNK_CONFIG],
    args.embeddingModel,
  );
  const { vectors } = await embedTexts(
    desired.map((c) => c.embeddedText),
    { apiKey: args.voyageKey, model: args.embeddingModel, inputType: "document" },
  );

  const { db, close } = createStandaloneDb(args.databaseUrl);
  const where = and(
    eq(loreChunks.worldId, args.worldId),
    eq(loreChunks.chunking, DEFAULT_CHUNKING),
  );
  try {
    await db.delete(loreChunks).where(where);
    await db.insert(loreChunks).values(
      desired.map((chunk, i) => ({
        worldId: chunk.worldId,
        chunking: chunk.chunking,
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        docType: chunk.docType,
        headingPath: chunk.headingPath,
        content: chunk.content,
        contentHash: chunk.contentHash,
        embedding: vectors[i],
        embeddingModel: args.embeddingModel,
        tokenEstimate: chunk.tokenEstimate,
      })),
    );
  } finally {
    await close();
  }

  return {
    chunks: desired.length,
    remove: async () => {
      const again = createStandaloneDb(args.databaseUrl);
      try {
        await again.db.delete(loreChunks).where(where);
      } finally {
        await again.close();
      }
    },
  };
}
