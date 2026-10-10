import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, isStepCount, streamText, validateUIMessages } from "ai";
import type { ChatMetadata } from "@/lib/ai/chat-metadata";
import { parseChatRequest } from "@/lib/ai/chat-request";
import { resolveModelId } from "@/lib/ai/models";
import { createTools } from "@/lib/ai/tools";
import { getEnv } from "@/lib/env";
import { getSystemPrompt, PROMPT_VERSION } from "@/lib/prompts";

// Vercel stops the function after this many seconds, so a stuck model call cannot run forever.
export const maxDuration = 30;

/** What the user sees when something fails. Details stay in the server log. */
const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function POST(request: Request): Promise<Response> {
  const body = parseChatRequest(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const tools = createTools();

  let messages;
  try {
    // Earlier assistant messages in the history contain tool parts: check them against our tools.
    messages = await validateUIMessages({ messages: body.messages, tools });
  } catch {
    return Response.json({ error: "Invalid messages." }, { status: 400 });
  }

  const modelId = resolveModelId(body.model, process.env.VERCEL_ENV);
  const anthropic = createAnthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });

  const result = streamText({
    model: anthropic(modelId),
    instructions: getSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools,
    // One step to call the tool, one to write the answer from its result, one spare.
    stopWhen: isStepCount(3),
    // Stop the model call when the user presses "Stop" (the browser aborts the request).
    abortSignal: request.signal,
    onError: ({ error }) => console.error("[chat] model error", error),
  });

  return result.toUIMessageStreamResponse({
    // Never send raw provider errors (they can contain internals) to the browser.
    onError: () => GENERIC_ERROR,
    // Sent once, when the model finishes. The benchmark script reads it to compute cost.
    messageMetadata: ({ part }): ChatMetadata | undefined =>
      part.type === "finish"
        ? {
            modelId,
            promptVersion: PROMPT_VERSION,
            inputTokens: part.totalUsage.inputTokens,
            outputTokens: part.totalUsage.outputTokens,
          }
        : undefined,
  });
}
