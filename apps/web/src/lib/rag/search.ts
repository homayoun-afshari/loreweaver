import { and, cosineDistance, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { loreChunks } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { DEFAULT_CHUNKING, type DocType } from "./constants";
import { embedTexts } from "./embeddings";
import type { LoreHit, SearchLoreOutput } from "./search-types";

export type { LoreHit, SearchLoreOutput } from "./search-types";

/** How many passages a search returns when the caller does not say. */
export const DEFAULT_TOP_K = 3;
/** The most passages one search may return: each one goes into the model's prompt. */
export const MAX_TOP_K = 8;
/**
 * Passages less similar than this are dropped, so an OFF-TOPIC question returns nothing instead
 * of the least-bad passages. It cannot do more than that: on the eval set, questions with an
 * answer scored 0.37 to 0.72 at best, off-topic ones 0.14 to 0.17, but unanswerable questions
 * that name real things of the lore scored 0.39 and 0.45, inside the range of real questions, and
 * a higher floor starts to silence real ones. For those the model is told to say the lore does
 * not cover it. The value belongs to this embedding model's scale (see docs/METRICS.md).
 */
export const MIN_SIMILARITY = 0.3;
/** Characters of the chunk's id used as its citation id. */
export const CITATION_ID_LENGTH = 8;

type Db = ReturnType<typeof getDb>;

export type NearestRow = {
  id: string;
  sourcePath: string;
  headingPath: string;
  docType: DocType;
  content: string;
  similarity: number;
};

/**
 * The retrieval query. THE WORLD FILTER LIVES HERE, in the WHERE clause, so a chunk of another
 * world can never be a candidate, however close its vector is. (Filtering the results afterwards
 * would waste the top-k slots on forbidden chunks and would let them pass through the server.)
 *
 * `<=>` is pgvector's cosine distance (0 = identical direction), so ordering by it ascending puts
 * the closest chunks first. There is no vector index, so Postgres compares the query with every
 * row of this world: exact, and fast at this size.
 */
export async function findNearestChunks(
  db: Db,
  args: { worldId: string; chunking: string; embedding: number[]; limit: number },
): Promise<NearestRow[]> {
  const distance = cosineDistance(loreChunks.embedding, args.embedding);
  const rows = await db
    .select({
      id: loreChunks.id,
      sourcePath: loreChunks.sourcePath,
      headingPath: loreChunks.headingPath,
      docType: loreChunks.docType,
      content: loreChunks.content,
      distance,
    })
    .from(loreChunks)
    .where(and(eq(loreChunks.worldId, args.worldId), eq(loreChunks.chunking, args.chunking)))
    .orderBy(distance)
    .limit(args.limit);
  return rows.map(({ distance: d, ...row }) => ({ ...row, similarity: 1 - Number(d) }));
}

/** The two things a search needs from the outside world. Replaced by fakes in unit tests. */
export type SearchLoreDeps = {
  embedQuery: (query: string) => Promise<number[]>;
  findNearest: (args: {
    worldId: string;
    chunking: string;
    embedding: number[];
    limit: number;
  }) => Promise<NearestRow[]>;
  chunking?: string;
};

export type SearchLoreArgs = {
  /** From the session on the server. Never from the model. */
  worldId: string;
  query: string;
  k?: number;
};

/** Embeds the question, finds the nearest passages of this world, and names each with a citation id. */
export async function searchLore(
  { worldId, query, k }: SearchLoreArgs,
  deps: SearchLoreDeps,
): Promise<SearchLoreOutput> {
  const limit = Math.min(MAX_TOP_K, Math.max(1, Math.trunc(k ?? DEFAULT_TOP_K)));
  try {
    const embedding = await deps.embedQuery(query.trim());
    const rows = await deps.findNearest({
      worldId,
      chunking: deps.chunking ?? DEFAULT_CHUNKING,
      embedding,
      limit,
    });
    const hits: LoreHit[] = rows
      .filter((row) => row.similarity >= MIN_SIMILARITY)
      .map((row) => ({
        citationId: row.id.slice(0, CITATION_ID_LENGTH),
        sourcePath: row.sourcePath,
        headingPath: row.headingPath,
        docType: row.docType,
        content: row.content,
        similarity: Math.round(row.similarity * 1000) / 1000,
      }));
    return { ok: true, hits };
  } catch (error) {
    // Details stay in the server log; the model and the browser get a generic message.
    console.error("[search_lore] failed", error);
    return {
      ok: false,
      error: { kind: "unavailable", message: "Lore search is unavailable right now." },
    };
  }
}

/** The real search: Voyage for the question's vector, Postgres for the nearest chunks. */
export function createLoreSearch(): (args: SearchLoreArgs) => Promise<SearchLoreOutput> {
  return (args) =>
    searchLore(args, {
      embedQuery: async (query) => {
        const env = getEnv();
        const { vectors } = await embedTexts([query], {
          apiKey: env.VOYAGE_API_KEY,
          model: env.EMBEDDING_MODEL,
          // The same model as the chunks, told that this text is a question, not a document.
          inputType: "query",
        });
        return vectors[0];
      },
      findNearest: (nearest) => findNearestChunks(getDb(), nearest),
    });
}
