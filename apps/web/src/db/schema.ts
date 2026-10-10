import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
