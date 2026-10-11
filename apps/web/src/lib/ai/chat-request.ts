import { z } from "zod";

/** Caps that keep one request from becoming an expensive one. */
export const MAX_MESSAGES = 30;
export const MAX_REQUEST_CHARS = 40_000;

/**
 * Shape of the body that `useChat` posts to /api/chat. Only the envelope is checked here:
 * the SDK validates each message's parts when converting them for the model.
 */
export const chatRequestSchema = z.object({
  messages: z
    .array(z.looseObject({ role: z.string() }))
    .min(1)
    .max(MAX_MESSAGES),
  /** Optional model override, honored outside production only (see resolveModelId). */
  model: z.string().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Parses the raw JSON body. Returns null when it is not a valid, reasonably sized request. */
export function parseChatRequest(body: unknown): ChatRequest | null {
  const result = chatRequestSchema.safeParse(body);
  if (!result.success) return null;
  if (JSON.stringify(result.data.messages).length > MAX_REQUEST_CHARS) return null;
  return result.data;
}
