import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import { REFLECTION_MODEL_ID, type ModelId } from "@/lib/ai/models";
import type { AgentModel, ReflectionModel } from "./nodes";
import { tokensOfReply } from "./state";
import { verdictSchema } from "./reflection";
import { TOOL_SPECS } from "./tools";

/** Answers are short, so the cap keeps one runaway reply from costing much. */
const AGENT_MAX_TOKENS = 1024;
const REFLECTION_MAX_TOKENS = 1024;

/**
 * Marks the system prompt as the end of the part of the request that repeats (prompt caching).
 * Anthropic builds a request's cacheable prefix in the order tools, system prompt, messages, so
 * one marker here caches the tool definitions and the system prompt together, and the next call
 * that starts with exactly the same text reads them from the cache at a tenth of the input price or
 * less. Anything that changes per request (the question, the tool results) comes after the marker.
 * It does nothing for a prompt below the model's minimum cacheable length (512 tokens for Sonnet
 * 5.5, 4,096 for Haiku 4.5): such a request is processed without caching and without an error.
 */
export function withCachedSystemPrompt(messages: BaseMessage[]): BaseMessage[] {
  const [first, ...rest] = messages;
  if (!first || first.type !== "system" || typeof first.content !== "string") return messages;
  const marked = new SystemMessage({
    content: [{ type: "text", text: first.content, cache_control: { type: "ephemeral" } }],
  });
  return [marked, ...rest];
}

/**
 * The drafting model: Claude, with the two tools offered to it when the node allows them. The
 * prompt is cached on the calls that offer the tools. The last call of a draft has no tools, so
 * its request does not start like the others and a marker would only pay for a cache write that
 * nothing reads; it is sent without one.
 */
export function createAgentModel(args: { apiKey: string; modelId: ModelId }): AgentModel {
  const chat = new ChatAnthropic({
    model: args.modelId,
    apiKey: args.apiKey,
    maxTokens: AGENT_MAX_TOKENS,
    // The author never sees a draft: the answer is sent once, after the check. A model that
    // streams its tokens would let a stream mode of the graph emit them, so it is switched off.
    disableStreaming: true,
  });
  const withTools = chat.bindTools([...TOOL_SPECS]);
  return async (messages, { allowTools }, config) =>
    (await (allowTools ? withTools : chat).invoke(
      allowTools ? withCachedSystemPrompt(messages) : messages,
      config,
    )) as AIMessage;
}

/** The checking model: a cheap Claude at temperature 0 that answers with the verdict's schema. */
export function createReflectionModel(args: { apiKey: string }): ReflectionModel {
  const chat = new ChatAnthropic({
    model: REFLECTION_MODEL_ID,
    apiKey: args.apiKey,
    temperature: 0,
    maxTokens: REFLECTION_MAX_TOKENS,
    // Also needed for the verdict to be read: when the model streams inside a graph that streams
    // messages, the structured reply came back unparsed (found in a live run).
    disableStreaming: true,
  });
  const structured = chat.withStructuredOutput(verdictSchema, {
    name: "verdict",
    includeRaw: true,
  });
  return async (messages, config) => {
    const { raw, parsed } = await structured.invoke(messages, config);
    return {
      verdict: parsed,
      usage: tokensOfReply((raw as AIMessage).usage_metadata),
    };
  };
}
