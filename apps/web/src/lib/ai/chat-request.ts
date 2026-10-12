import { z } from "zod";
import { MAX_USER_MESSAGE_CHARS } from "./input-limits";

/** Caps that keep one request from becoming an expensive one. */
export const MAX_MESSAGES = 30;
export { MAX_USER_MESSAGE_CHARS };
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

/** The characters of the text parts of a message. */
function textLength(message: Record<string, unknown>): number {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.reduce(
    (total: number, part: unknown) =>
      total +
      (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "").length
        : 0),
    0,
  );
}

/** Whether the newest message is the author's and is longer than the limit. */
function newestMessageTooLong(messages: ChatRequest["messages"]): boolean {
  // The newest message is the one the author just wrote. Earlier ones are history the app sent back.
  const last = messages.at(-1);
  return last?.role === "user" && textLength(last) > MAX_USER_MESSAGE_CHARS;
}

/** Parses the raw JSON body. Returns null when it is not a valid, reasonably sized request. */
export function parseChatRequest(body: unknown): ChatRequest | null {
  const result = chatRequestSchema.safeParse(body);
  if (!result.success) return null;
  if (JSON.stringify(result.data.messages).length > MAX_REQUEST_CHARS) return null;
  if (newestMessageTooLong(result.data.messages)) return null;
  return result.data;
}

/**
 * True when a newest message over the limit is the reason a body can be refused. It lets the route
 * say so, instead of the generic "invalid request" that the author cannot fix.
 */
export function isMessageTooLong(body: unknown): boolean {
  const result = chatRequestSchema.safeParse(body);
  return result.success && newestMessageTooLong(result.data.messages);
}
