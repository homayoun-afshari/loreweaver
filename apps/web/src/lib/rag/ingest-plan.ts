import { createHash } from "node:crypto";
import {
  type ChunkConfig,
  type ChunkConfigName,
  chunkMarkdown,
  estimateTokens,
  textToEmbed,
} from "./chunking";
import type { DocType } from "./constants";
import type { LoreFile } from "./lore-files";

/** A chunk as it should exist in the database after ingestion. */
export type DesiredChunk = {
  worldId: string;
  chunking: string;
  sourcePath: string;
  chunkIndex: number;
  docType: DocType;
  headingPath: string;
  content: string;
  /** What is sent to the embedding model (the heading path may be put in front of the content). */
  embeddedText: string;
  contentHash: string;
  tokenEstimate: number;
};

/** What the database already holds for one chunk position. */
export type ExistingChunk = {
  sourcePath: string;
  chunkIndex: number;
  docType: DocType;
  headingPath: string;
  contentHash: string;
  embedding: number[];
};

/**
 * The hash covers the embedding model and the exact text that is embedded. If either changes,
 * the hash changes and the chunk is embedded again. If neither changes, the old vector is still
 * correct and nothing is paid for. Everything else about a chunk (its place, its labels) does
 * not influence the vector, so it is not part of the hash.
 */
export function hashForEmbedding(model: string, embeddedText: string): string {
  return createHash("sha256").update(`${model}\n${embeddedText}`).digest("hex");
}

/** Cuts every file with one configuration and numbers the chunks of each file from 0. */
export function buildDesiredChunks(
  files: LoreFile[],
  chunking: ChunkConfigName | string,
  config: ChunkConfig,
  model: string,
): DesiredChunk[] {
  return files.flatMap((file) =>
    chunkMarkdown(file.markdown, config).map((chunk, chunkIndex) => {
      const embeddedText = textToEmbed(chunk, config);
      return {
        worldId: file.worldId,
        chunking,
        sourcePath: file.sourcePath,
        chunkIndex,
        docType: file.docType,
        headingPath: chunk.headingPath,
        content: chunk.content,
        embeddedText,
        contentHash: hashForEmbedding(model, embeddedText),
        tokenEstimate: estimateTokens(chunk.content),
      };
    }),
  );
}

export type IngestPlan = {
  /** Already stored with the right content: nothing to do. */
  keep: DesiredChunk[];
  /** New place, but the same text is already stored elsewhere: copy its vector, no API call. */
  copy: { chunk: DesiredChunk; embedding: number[] }[];
  /** Needs a vector. Several chunks with the same text appear once, so it is paid for once. */
  embed: DesiredChunk[];
  /** All chunks that must be written to the database (copy + embed), filled in by `withEmbeddings`. */
  write: DesiredChunk[];
  /** Stored chunks whose place no longer exists (a deleted file or a shorter section). */
  remove: { sourcePath: string; chunkIndex: number }[];
};

const place = (c: { sourcePath: string; chunkIndex: number }) => `${c.sourcePath}#${c.chunkIndex}`;

/**
 * Compares what should exist with what exists, for one world and one chunking configuration.
 * Running ingestion twice on the same files gives a plan with nothing to embed and nothing to write.
 */
export function planIngest(desired: DesiredChunk[], existing: ExistingChunk[]): IngestPlan {
  const existingByPlace = new Map(existing.map((e) => [place(e), e]));
  const existingByHash = new Map(existing.map((e) => [e.contentHash, e]));
  const desiredPlaces = new Set(desired.map(place));

  const plan: IngestPlan = { keep: [], copy: [], embed: [], write: [], remove: [] };
  const seenHashes = new Set<string>();

  for (const chunk of desired) {
    // Same text is not enough to keep a row: its labels must be current too. A changed doc_type
    // or heading path rewrites the row, but reuses the vector, so it costs nothing.
    const stored = existingByPlace.get(place(chunk));
    if (
      stored?.contentHash === chunk.contentHash &&
      stored.docType === chunk.docType &&
      stored.headingPath === chunk.headingPath
    ) {
      plan.keep.push(chunk);
      continue;
    }
    plan.write.push(chunk);
    const sameText = existingByHash.get(chunk.contentHash);
    if (sameText) {
      plan.copy.push({ chunk, embedding: sameText.embedding });
    } else if (!seenHashes.has(chunk.contentHash)) {
      seenHashes.add(chunk.contentHash);
      plan.embed.push(chunk);
    }
  }

  plan.remove = existing
    .filter((e) => !desiredPlaces.has(place(e)))
    .map(({ sourcePath, chunkIndex }) => ({ sourcePath, chunkIndex }));
  return plan;
}

/** Pairs every chunk to write with its vector, once the missing vectors have been fetched. */
export function withEmbeddings(
  plan: IngestPlan,
  embedded: { chunk: DesiredChunk; embedding: number[] }[],
): { chunk: DesiredChunk; embedding: number[] }[] {
  const byHash = new Map<string, number[]>();
  for (const { chunk, embedding } of [...plan.copy, ...embedded]) {
    byHash.set(chunk.contentHash, embedding);
  }
  return plan.write.map((chunk) => {
    const embedding = byHash.get(chunk.contentHash);
    if (!embedding) throw new Error(`No vector for ${place(chunk)}.`);
    return { chunk, embedding };
  });
}
