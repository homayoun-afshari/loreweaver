import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { DOC_TYPES, EMBEDDING_DIMENSIONS } from "@/lib/rag/constants";

/** What the author did with an assistant message. */
export const feedbackKind = pgEnum("feedback_kind", ["up", "down", "copy"]);

/**
 * One row per click: an append-only event log, not a "current rating" per message.
 * If someone clicks up and then down, both events are kept, and the order tells the story.
 * Only ids are stored, never the message text.
 *
 * Row Level Security is switched on with no policies. Supabase exposes tables in the public
 * schema through its own web API, and RLS closes that door. The app is not affected: it connects
 * with the database owner role, which bypasses RLS.
 */
export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The chat session (one page load) the message belongs to. */
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    kind: feedbackKind("kind").notNull(),
    /** Which model wrote the message, so feedback can be compared per model. */
    modelId: text("model_id"),
    /** Which system prompt version was used (see src/lib/prompts), to compare prompts. */
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("feedback_events_message_idx").on(table.messageId)],
).enableRLS();

export type NewFeedbackEvent = typeof feedbackEvents.$inferInsert;

/** The kind of a lore document, set in the front matter of its Markdown file. */
export const loreDocType = pgEnum("lore_doc_type", DOC_TYPES);

/**
 * The search index of the lore: one row per chunk of a Markdown file in data/lore. It is an
 * index, not the source of truth. The files are, and `pnpm ingest` can rebuild every row.
 *
 * `chunking` is the name of the chunking configuration (for example "heading-800"). Chunks made
 * with different configurations live side by side, so they can be compared without re-embedding.
 * A chunk's place is (world, chunking, file, position in the file); ingestion updates in place.
 *
 * There is no vector index on purpose: at a few hundred rows an exact scan is fast and always
 * returns the true nearest neighbours. Same Row Level Security reasoning as `feedback_events`.
 */
export const loreChunks = pgTable(
  "lore_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The tenant. The search always filters on it, taken from the session, never from the model. */
    worldId: text("world_id").notNull(),
    chunking: text("chunking").notNull(),
    /** Repo-relative path of the Markdown file, with forward slashes. Shown in citations. */
    sourcePath: text("source_path").notNull(),
    /** Position of the chunk inside its file, starting at 0. */
    chunkIndex: integer("chunk_index").notNull(),
    docType: loreDocType("doc_type").notNull(),
    /** The headings above the chunk, joined with " > ". Shown in citations. */
    headingPath: text("heading_path").notNull(),
    /** The chunk's text, which is what the model reads and the author sees. */
    content: text("content").notNull(),
    /** Hash of the embedding model and the exact text that was embedded. Decides re-embedding. */
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    /** Estimated tokens of `content` (characters / 4), for sizing and reports. */
    tokenEstimate: integer("token_estimate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lore_chunks_position_uq").on(
      table.worldId,
      table.chunking,
      table.sourcePath,
      table.chunkIndex,
    ),
    index("lore_chunks_world_idx").on(table.worldId, table.chunking),
  ],
).enableRLS();

export type NewLoreChunk = typeof loreChunks.$inferInsert;
