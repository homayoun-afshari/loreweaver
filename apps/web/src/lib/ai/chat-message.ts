import type { UIMessage } from "ai";
import type { ChatMetadata } from "./chat-metadata";
import type { ChatTools } from "./tools";

/** The custom data parts the route may send next to the text and the tool parts. */
export type ChatDataParts = {
  /** A short note about what the agent is doing. Sent as a transient part: it is never kept. */
  status: { text: string };
};

/**
 * One chat message, as the route sends it and the browser reads it. Tool parts are typed with our
 * tools, so `part.output` has a real type. Type-only: safe to import in the browser.
 */
export type ChatMessage = UIMessage<ChatMetadata, ChatDataParts, ChatTools>;
