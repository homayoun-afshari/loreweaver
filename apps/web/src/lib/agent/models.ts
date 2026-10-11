import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessage } from "@langchain/core/messages";
import { REFLECTION_MODEL_ID, type ModelId } from "@/lib/ai/models";
import type { AgentModel, ReflectionModel } from "./nodes";
import { verdictSchema } from "./reflection";
import { TOOL_SPECS } from "./tools";

/** Answers are short, so the cap keeps one runaway reply from costing much. */
const AGENT_MAX_TOKENS = 1024;
const REFLECTION_MAX_TOKENS = 1024;

/** The drafting model: Claude, with the two tools offered to it when the node allows them. */
export function createAgentModel(args: { apiKey: string; modelId: ModelId }): AgentModel {
  const chat = new ChatAnthropic({
    model: args.modelId,
    apiKey: args.apiKey,
    maxTokens: AGENT_MAX_TOKENS,
  });
  const withTools = chat.bindTools([...TOOL_SPECS]);
  return async (messages, { allowTools }, config) =>
    (await (allowTools ? withTools : chat).invoke(messages, config)) as AIMessage;
}

/** The checking model: a cheap Claude at temperature 0 that answers with the verdict's schema. */
export function createReflectionModel(args: { apiKey: string }): ReflectionModel {
  const chat = new ChatAnthropic({
    model: REFLECTION_MODEL_ID,
    apiKey: args.apiKey,
    temperature: 0,
    maxTokens: REFLECTION_MAX_TOKENS,
  });
  const structured = chat.withStructuredOutput(verdictSchema, { name: "verdict" });
  return (messages, config) => structured.invoke(messages, config);
}
