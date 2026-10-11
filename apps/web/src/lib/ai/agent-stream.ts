import type { BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { UIMessageChunk } from "ai";
import { addUsage, noUsage, type Usage } from "@/lib/agent/state";
import { textOf } from "@/lib/agent/messages";
import type { ChatDataParts } from "./chat-message";
import type { ChatMetadata } from "./chat-metadata";

/**
 * Turns the agent's progress into the chunks the chat reads (see ADR-0004). This is the one place
 * that knows both sides: the graph's updates in, the AI SDK's UI message stream out.
 *
 * What it sends, and what it does not:
 *  - Tool progress goes out as it happens: a tool call as soon as the agent asks for it, its
 *    result as soon as the tool is done. The browser draws the cards from these.
 *  - Draft text, revisions, the reflection verdict and its model call never go out. The answer is
 *    sent once, after the last node has finished: the validated draft, or the best draft with
 *    its caveat.
 */

export const CHECKING_TEXT = "Checking against world rules…";

type Chunk = UIMessageChunk<ChatMetadata, ChatDataParts>;

/** Where the chunks go: the writer that `createUIMessageStream` hands to its callback. */
export type ChunkSink = { write(chunk: Chunk): void };

/** What the route needs of its timer. */
export type StreamTimer = {
  markChunk(type: string): void;
  snapshot(): Pick<ChatMetadata, "serverTtftMs" | "serverFirstUiMs" | "serverTotalMs">;
};

/** What a node returns, as the "updates" stream mode reports it. */
type NodeUpdate = { messages?: BaseMessage[]; draftAnswer?: string; usage?: Usage };

/** A tool's result, read from the message the tools node adds. */
function readToolResult(message: ToolMessage): { output: unknown } | { errorText: string } {
  const raw = textOf(message);
  if (message.status === "error") {
    let text = "The tool failed.";
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      text = parsed.error?.message ?? text;
    } catch {
      // The message was not JSON: keep the generic text.
    }
    return { errorText: text };
  }
  try {
    return { output: JSON.parse(raw) as unknown };
  } catch {
    return { errorText: "The tool returned an unreadable result." };
  }
}

/**
 * Reads the updates of one agent run (`graph.stream(..., { streamMode: "updates" })`) and writes
 * the chunks of one assistant message. Resolves when the message is complete. A failure of the
 * run is thrown, for the caller to turn into an error chunk.
 */
export async function writeAgentRun(args: {
  sink: ChunkSink;
  updates: AsyncIterable<unknown>;
  timer: StreamTimer;
  meta: Pick<ChatMetadata, "modelId" | "promptVersion">;
  /** Called with the tokens spent so far each time they grow, also when the run fails later. */
  onUsage?: (usage: Usage) => void;
}): Promise<void> {
  const { sink, timer } = args;
  let stepOpen = false;
  let answer = "";
  let usage: Usage = noUsage();

  const openStep = () => {
    if (!stepOpen) sink.write({ type: "start-step" });
    stepOpen = true;
  };
  const closeStep = () => {
    if (stepOpen) sink.write({ type: "finish-step" });
    stepOpen = false;
  };

  sink.write({ type: "start" });

  for await (const chunk of args.updates) {
    for (const [node, update] of Object.entries(chunk as Record<string, NodeUpdate | undefined>)) {
      if (!update) continue;
      if (update.usage) {
        usage = addUsage(usage, update.usage);
        args.onUsage?.(usage);
      }
      // The agent's drafts and the reflection node's caveat both set it; the last one wins.
      if (typeof update.draftAnswer === "string") answer = update.draftAnswer;

      const messages = update.messages ?? [];
      if (node === "agent") {
        for (const message of messages) {
          if (message.type !== "ai") continue;
          const calls = (message as { tool_calls?: { id?: string; name: string; args: unknown }[] })
            .tool_calls;
          if (calls && calls.length > 0) {
            openStep();
            for (const [index, call] of calls.entries()) {
              sink.write({
                type: "tool-input-available",
                // The same fallback as the tools node, so a result finds its call.
                toolCallId: call.id ?? `call_${index}`,
                toolName: call.name,
                input: call.args,
              });
            }
            timer.markChunk("tool-input-available");
          } else {
            // A draft is ready, and is about to be checked. Its text stays here.
            sink.write({ type: "data-status", data: { text: CHECKING_TEXT }, transient: true });
          }
        }
      } else if (node === "tools") {
        for (const message of messages) {
          if (message.type !== "tool") continue;
          const tool = message as ToolMessage;
          const result = readToolResult(tool);
          if ("output" in result) {
            sink.write({
              type: "tool-output-available",
              toolCallId: tool.tool_call_id,
              output: result.output,
            });
          } else {
            sink.write({
              type: "tool-output-error",
              toolCallId: tool.tool_call_id,
              errorText: result.errorText,
            });
          }
        }
        closeStep();
      }
      // The reflection node's verdict and feedback note are not sent.
    }
  }

  closeStep();
  if (answer.trim() !== "") {
    const id = "answer";
    sink.write({ type: "start-step" });
    sink.write({ type: "text-start", id });
    sink.write({ type: "text-delta", id, delta: answer });
    timer.markChunk("text-delta");
    sink.write({ type: "text-end", id });
    sink.write({ type: "finish-step" });
  }

  sink.write({
    type: "finish",
    messageMetadata: {
      ...args.meta,
      // The drafting model's tokens, which its price applies to. Reflection has its own fields.
      inputTokens: usage.agent.input,
      outputTokens: usage.agent.output,
      reflectionInputTokens: usage.reflection.input,
      reflectionOutputTokens: usage.reflection.output,
      ...timer.snapshot(),
    },
  });
}
