/**
 * Extra facts the route attaches to each assistant message, sent once when the model finishes.
 * The browser keeps them on the message, and sends modelId and promptVersion back with feedback.
 */
export type ChatMetadata = {
  modelId?: string;
  promptVersion?: string;
  /** Tokens of the drafting model (the one in `modelId`), over all its calls for this answer. */
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens of the reflection model, which checks the drafts (see lib/agent). */
  reflectionInputTokens?: number;
  reflectionOutputTokens?: number;
  /** Server-side timing in milliseconds, from the route starting (see server-timing.ts). */
  serverTtftMs?: number;
  serverFirstUiMs?: number;
  serverTotalMs?: number;
};
