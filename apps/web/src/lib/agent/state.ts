import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/** One rule the draft breaks. `rule_id` is the citation id of a lore passage, or a fixed word. */
export type Violation = { rule_id: string; explanation: string };

/** What the reflection step decided about a draft. */
export type Verdict = { valid: boolean; violations: Violation[] };

/** Tokens of the model calls of one kind. */
export type TokenUsage = { input: number; output: number };

/** Tokens spent in a run, split by what spent them: drafting (with its revisions) and checking. */
export type Usage = { agent: TokenUsage; reflection: TokenUsage };

export const noUsage = (): Usage => ({
  agent: { input: 0, output: 0 },
  reflection: { input: 0, output: 0 },
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    agent: { input: a.agent.input + b.agent.input, output: a.agent.output + b.agent.output },
    reflection: {
      input: a.reflection.input + b.reflection.input,
      output: a.reflection.output + b.reflection.output,
    },
  };
}

/**
 * The data every node of the graph shares (see docs/AGENT_DESIGN.md).
 *
 * The world is NOT here: it is set by the server in the run's configuration, so the model and
 * the nodes cannot change it.
 */
export const AgentState = Annotation.Root({
  /** The conversation, with tool calls and tool results. New messages are appended. */
  ...MessagesAnnotation.spec,
  /** The latest draft the author could receive. A new draft replaces the old one. */
  draftAnswer: Annotation<string>({ reducer: (_old, value) => value, default: () => "" }),
  /** The latest verdict of the reflection step, or null before the first one. */
  reflection: Annotation<Verdict | null>({
    reducer: (_old, value) => value,
    default: () => null,
  }),
  /** How many revisions were requested so far. */
  iterations: Annotation<number>({ reducer: (_old, value) => value, default: () => 0 }),
  /** Tokens spent so far. Every node adds its own, so the total is the sum. */
  usage: Annotation<Usage>({ reducer: addUsage, default: noUsage }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
