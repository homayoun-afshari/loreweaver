/**
 * Numbers and names shared by the database schema, the ingestion script and the search code.
 * Kept in one dependency-free file so the schema can import it without pulling in anything else.
 */

/**
 * Size of every embedding vector. It must match the database column (`vector(1024)`), and it is
 * sent to the embedding provider on every request, so the two can never disagree silently.
 * Changing it needs a new migration and a full re-embedding.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * The chunking configuration the search reads. Ingestion can store several configurations side by
 * side (see chunking.ts); this is the one the chat uses, until the experiment decides.
 */
export const DEFAULT_CHUNKING = "heading-800";

/** The kinds of lore document. The value comes from the `doc_type` line of a file's front matter. */
export const DOC_TYPES = ["rule", "location", "history", "character"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Rough conversion between characters and tokens for English text. Chunk sizes are limits in
 * tokens, but counting real tokens would need the provider's tokenizer. Four characters per token
 * is the usual rule of thumb. The real count of what was billed comes back from the provider.
 */
export const CHARS_PER_TOKEN = 4;
