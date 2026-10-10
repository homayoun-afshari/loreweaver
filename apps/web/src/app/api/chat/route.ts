import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, validateUIMessages } from "ai";
import { parseChatRequest } from "@/lib/ai/chat-request";
import { resolveModelId } from "@/lib/ai/models";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getEnv } from "@/lib/env";

// Vercel stops the function after this many seconds, so a stuck model call cannot run forever.
export const maxDuration = 30;

/** What the user sees when something fails. Details stay in the server log. */
const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function POST(request: Request): Promise<Response> {
  const body = parseChatRequest(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  let messages;
  try {
    messages = await validateUIMessages({ messages: body.messages });
  } catch {
    return Response.json({ error: "Invalid messages." }, { status: 400 });
  }

  const modelId = resolveModelId(body.model, process.env.VERCEL_ENV);
  const anthropic = createAnthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });

  const result = streamText({
    model: anthropic(modelId),
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    // Stop the model call when the user presses "Stop" (the browser aborts the request).
    abortSignal: request.signal,
    onError: ({ error }) => console.error("[chat] model error", error),
  });

  return result.toUIMessageStreamResponse({
    // Never send raw provider errors (they can contain internals) to the browser.
    onError: () => GENERIC_ERROR,
    // Sent once, when the model finishes. The bake-off script reads it to compute cost.
    messageMetadata: ({ part }) =>
      part.type === "finish"
        ? {
            modelId,
            inputTokens: part.totalUsage.inputTokens,
            outputTokens: part.totalUsage.outputTokens,
          }
        : undefined,
  });
}
