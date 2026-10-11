import {
  doublePrecision,
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

/** How far a chat request got: it is recorded when it starts, so a running request counts too. */
export const usageStatus = pgEnum("usage_status", ["started", "completed", "failed"]);

/**
 * One row per chat request: who asked, what it used and what it cost. It feeds two limits (a rate
 * limit and a daily token budget) and the reading of the cost. A row is inserted when the request
 * starts, with no tokens, and updated when it ends. Only ids and counts are stored, never text.
 *
 * `visitor_id` is a random id kept in a cookie (see lib/visitor.ts), not an account. The tokens are
 * those of all the model calls of the request (drafting and checking). `input_tokens` leaves out
 * the cached ones, which are listed apart, so the four token columns do not overlap.
 *
 * Same Row Level Security reasoning as `feedback_events`.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitorId: text("visitor_id").notNull(),
    worldId: text("world_id").notNull(),
    /** The drafting model of the request. */
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: usageStatus("status").notNull().default("started"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** List-price cost in USD, from the prices in lib/ai/models.ts at the time. */
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    /** From the start of the request to the end of the run. Empty while it runs. */
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_visitor_idx").on(table.visitorId, table.createdAt)],
).enableRLS();

export type NewUsageEvent = typeof usageEvents.$inferInsert;

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
 * returns the true nearest neighbors. Same Row Level Security reasoning as `feedback_events`.
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
