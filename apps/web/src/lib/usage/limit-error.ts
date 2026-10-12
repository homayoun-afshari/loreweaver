import { z } from "zod";

/**
 * What the chat route answers when a visitor is over a limit (HTTP 429). The chat library hands
 * the browser the text of a failed response as the message of its error, so the browser reads it
 * back here to show the sentence instead of a generic failure.
 */
const limitErrorSchema = z.object({
  error: z.enum(["rate_limited", "daily_budget"]),
  message: z.string().min(1).max(300),
  retryAfterSeconds: z.number().int().positive(),
});

export type LimitError = z.infer<typeof limitErrorSchema>;

/** The limit error in an error message, or null when it is any other failure. */
export function parseLimitError(errorMessage: string | undefined): LimitError | null {
  if (!errorMessage) return null;
  try {
    const result = limitErrorSchema.safeParse(JSON.parse(errorMessage));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * What the chat route answers when the newest message is over the length limit (HTTP 413). Like the
 * limits above, the browser reads it back from the message of the chat library's error.
 */
const tooLongSchema = z.object({
  error: z.literal("message_too_long"),
  message: z.string().min(1).max(300),
  maxChars: z.number().int().positive(),
});

export type TooLongError = z.infer<typeof tooLongSchema>;

/** The too-long answer in an error message, or null when it is any other failure. */
export function parseTooLongError(errorMessage: string | undefined): TooLongError | null {
  if (!errorMessage) return null;
  try {
    const result = tooLongSchema.safeParse(JSON.parse(errorMessage));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
