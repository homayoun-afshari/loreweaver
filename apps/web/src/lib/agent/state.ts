import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/** One rule the draft breaks. `rule_id` is the citation id of a lore passage, or a fixed word. */
export type Violation = { rule_id: string; explanation: string };

/** What the reflection step decided about a draft. */
export type Verdict = { valid: boolean; violations: Violation[] };

/**
 * Tokens of the model calls of one kind. `input` is every input token, as the provider counts
 * them: it includes the tokens read from or written to the prompt cache, which are listed apart
 * too. What is neither is `input - cacheRead - cacheWrite`.
 */
export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Tokens spent in a run, split by what spent them: drafting (with its revisions) and checking. */
export type Usage = { agent: TokenUsage; reflection: TokenUsage };

export const noTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export const addTokens = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

export const noUsage = (): Usage => ({ agent: noTokens(), reflection: noTokens() });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    agent: addTokens(a.agent, b.agent),
    reflection: addTokens(a.reflection, b.reflection),
  };
}

/** The tokens of one model reply, from the usage record that LangChain puts on it. */
export function tokensOfReply(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number; cache_creation?: number };
      }
    | undefined,
): TokenUsage {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.input_token_details?.cache_read ?? 0,
    cacheWrite: usage?.input_token_details?.cache_creation ?? 0,
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
