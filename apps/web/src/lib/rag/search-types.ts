import type { DocType } from "./constants";

/**
 * Types of the search result, in a file with no server code, so the browser can import them
 * (type-only) to draw the citation cards without pulling in the database.
 */

/** One passage of the lore that matched a question. */
export type LoreHit = {
  /** Short, stable id of the chunk. The model cites it as [id] and the card shows the same id. */
  citationId: string;
  /** Repo-relative path of the Markdown file, for example "data/lore/world_aethel/magic-system.md". */
  sourcePath: string;
  /** The headings above the passage, joined with " > ". */
  headingPath: string;
  docType: DocType;
  /** The passage itself. */
  content: string;
  /** Cosine similarity to the question, 0 to 1 (higher is closer). */
  similarity: number;
};

/**
 * What `search_lore` hands back. A failure is data, not an exception, so the model can say
 * "the lore search is unavailable" and the browser can draw an error card, like the character tool.
 */
export type SearchLoreOutput =
  { ok: true; hits: LoreHit[] } | { ok: false; error: { kind: "unavailable"; message: string } };
