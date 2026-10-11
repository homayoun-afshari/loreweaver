import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/** One rule the draft breaks. `rule_id` is the citation id of a lore passage, or a fixed word. */
export type Violation = { rule_id: string; explanation: string };

/** What the reflection step decided about a draft. */
export type Verdict = { valid: boolean; violations: Violation[] };

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
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
