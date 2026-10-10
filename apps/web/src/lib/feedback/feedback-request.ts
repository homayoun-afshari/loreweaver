import { z } from "zod";
import { isModelId } from "@/lib/ai/models";
import type { NewFeedbackEvent } from "@/db/schema";

/** What the browser sends to POST /api/feedback. */
export const feedbackRequestSchema = z.object({
  chatId: z.string().min(1).max(100),
  messageId: z.string().min(1).max(100),
  kind: z.enum(["up", "down", "copy"]),
  /** Reported by the browser, so treated as a label only (see toFeedbackRow). */
  modelId: z.string().max(100).optional(),
  promptVersion: z.string().max(100).optional(),
});

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

/** Parses the raw JSON body. Returns null when it is not a valid feedback event. */
export function parseFeedbackRequest(body: unknown): FeedbackRequest | null {
  const result = feedbackRequestSchema.safeParse(body);
  return result.success ? result.data : null;
}

const PROMPT_VERSION_PATTERN = /^[\w.-]{1,50}$/;

/**
 * Turns a request into a database row. The model and prompt labels come from the browser, so
 * they are only kept when they look like values we produce: an allowlisted model id and a
 * simple version string. Anything else is stored as null instead of letting junk into the data.
 */
export function toFeedbackRow(request: FeedbackRequest): NewFeedbackEvent {
  return {
    chatId: request.chatId,
    messageId: request.messageId,
    kind: request.kind,
    modelId: isModelId(request.modelId) ? request.modelId : null,
    promptVersion:
      request.promptVersion && PROMPT_VERSION_PATTERN.test(request.promptVersion)
        ? request.promptVersion
        : null,
  };
}
