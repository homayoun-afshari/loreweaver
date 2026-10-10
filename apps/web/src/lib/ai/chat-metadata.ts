/**
 * Extra facts the route attaches to each assistant message, sent once when the model finishes.
 * The browser keeps them on the message, and sends modelId and promptVersion back with feedback.
 */
export type ChatMetadata = {
  modelId?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
};
