import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentModel, ReflectionModel } from "./nodes";

/**
 * Deterministic stand-ins for the two models, for tests. They return what they are told, in
 * order, and remember what they were asked, so a test can check both sides.
 */

export function toolCall(name: string, args: Record<string, unknown>, id = `call_${name}`) {
  return { id, name, args, type: "tool_call" as const };
}

/** A model message that asks for tools. */
export function asksFor(...calls: ReturnType<typeof toolCall>[]): AIMessage {
  return new AIMessage({ content: "", tool_calls: calls });
}

/** A model message that is a draft. */
export function draft(text: string): AIMessage {
  return new AIMessage({ content: text });
}

export type AgentCall = { messages: BaseMessage[]; allowTools: boolean };

/**
 * A drafting model that plays a script: the n-th call returns the n-th reply (the last reply
 * repeats). A reply can also be a function of the call, to react to `allowTools`.
 */
export function fakeAgentModel(script: (AIMessage | ((call: AgentCall) => AIMessage))[]) {
  const calls: AgentCall[] = [];
  const model: AgentModel = async (messages, { allowTools }) => {
    calls.push({ messages, allowTools });
    const entry = script[Math.min(calls.length - 1, script.length - 1)];
    return typeof entry === "function" ? entry(calls[calls.length - 1]) : entry;
  };
  return { model, calls };
}

/** A reflection model that plays a script of raw replies (or errors), repeating the last one. */
export function fakeReflectionModel(script: unknown[]) {
  const calls: BaseMessage[][] = [];
  const model: ReflectionModel = async (messages) => {
    calls.push(messages);
    const entry = script[Math.min(calls.length - 1, script.length - 1)];
    if (entry instanceof Error) throw entry;
    return { verdict: entry, usage: { input: 100, output: 10 } };
  };
  return { model, calls };
}

export const valid = { violations: [], valid: true };

export function invalid(...violations: { rule_id: string; explanation: string }[]) {
  return { violations, valid: false };
}
