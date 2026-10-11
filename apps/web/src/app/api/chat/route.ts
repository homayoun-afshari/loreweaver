import { toBaseMessages } from "@ai-sdk/langchain";
import { createUIMessageStream, createUIMessageStreamResponse, validateUIMessages } from "ai";
import { agentRunConfig } from "@/lib/agent";
import { getAgentGraph } from "@/lib/ai/agent-runtime";
import { writeAgentRun } from "@/lib/ai/agent-stream";
import type { ChatMessage } from "@/lib/ai/chat-message";
import { parseChatRequest } from "@/lib/ai/chat-request";
import { createChatTimer } from "@/lib/ai/server-timing";
import { resolveModelId } from "@/lib/ai/models";
import { createTools } from "@/lib/ai/tools";
import { PROMPT_VERSION } from "@/lib/prompts";
import { getSessionWorldId } from "@/lib/session";

// Vercel stops the function after this many seconds, so a stuck model call cannot run forever.
export const maxDuration = 30;

/** What the user sees when something fails. Details stay in the server log. */
const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const timer = createChatTimer();
  const body = parseChatRequest(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // The world comes from the session on the server. The model never chooses it, and cannot see it.
  const worldId = getSessionWorldId(request);

  let history;
  try {
    // Earlier assistant messages in the history contain tool parts: check them against our tools.
    const messages = await validateUIMessages({
      messages: body.messages,
      tools: createTools({ worldId }),
    });
    history = await toBaseMessages(messages);
  } catch {
    return Response.json({ error: "Invalid messages." }, { status: 400 });
  }

  const modelId = resolveModelId(body.model, process.env.VERCEL_ENV);
  const graph = getAgentGraph(modelId);

  const stream = createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      // The graph runs headlessly (see ADR-0004); this route only turns its progress into the
      // chat's stream. Only node updates are streamed: no draft text can reach the browser.
      const updates = await graph.stream(
        { messages: history },
        {
          ...agentRunConfig(worldId, startedAt),
          streamMode: "updates",
          // Stop the run when the user presses "Stop" (the browser aborts the request).
          signal: request.signal,
        },
      );
      await writeAgentRun({
        sink: writer,
        updates,
        timer,
        meta: { modelId, promptVersion: PROMPT_VERSION },
      });
    },
    // Never send raw provider errors (they can contain internals) to the browser.
    onError: (error) => {
      if (!request.signal.aborted) console.error("[chat] agent error", error);
      return GENERIC_ERROR;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
