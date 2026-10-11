import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolInputParsingException } from "@langchain/core/tools";
import { END } from "@langchain/langgraph";
import { MAX_AGENT_CALLS_PER_DRAFT, REVISION_CUTOFF_MS } from "./config";
import {
  callsForCurrentDraft,
  feedbackMessage,
  isFeedbackMessage,
  splitCurrentRun,
  textOf,
} from "./messages";
import {
  buildReflectionMessages,
  caveatFor,
  checkUnavailable,
  invalidVerdict,
  isCheckUnavailable,
  revisionRequest,
  RULE_EMPTY_ANSWER,
  toVerdict,
} from "./reflection";
import { noUsage, type AgentStateType, type AgentStateUpdate, type TokenUsage } from "./state";
import type { AgentTool } from "./tools";

/**
 * The drafting model, as a function so tests can replace it. It returns the model's next message,
 * with tool calls when `allowTools` is true and it chose to use them.
 */
export type AgentModel = (
  messages: BaseMessage[],
  options: { allowTools: boolean },
  config?: RunnableConfig,
) => Promise<AIMessage>;

/**
 * The reflection model, as a function: it returns the structured verdict, not yet validated, and
 * the tokens the call used when the provider reports them.
 */
export type ReflectionModel = (
  messages: BaseMessage[],
  config?: RunnableConfig,
) => Promise<{ verdict: unknown; usage?: TokenUsage }>;

/** The world of this run. It is set by the server, so a run without one is a bug, not an input. */
export function worldIdOf(config?: RunnableConfig): string {
  const worldId = config?.configurable?.worldId;
  if (typeof worldId !== "string" || worldId === "") {
    throw new Error("The agent needs a worldId in its run configuration.");
  }
  return worldId;
}

function toolCallsOf(message: BaseMessage | undefined) {
  return message?.type === "ai" ? ((message as AIMessage).tool_calls ?? []) : [];
}

/**
 * The agent node: the drafting model decides to call a tool or writes a draft. It reads the whole
 * conversation, including the feedback of an earlier reflection.
 */
export function createAgentNode(deps: {
  model: AgentModel;
  systemPromptFor: (worldId: string) => string;
}) {
  return async (state: AgentStateType, config: RunnableConfig): Promise<AgentStateUpdate> => {
    const systemPrompt = deps.systemPromptFor(worldIdOf(config));
    // The last call of a draft has no tools, so the model has to answer instead of asking again.
    const allowTools = callsForCurrentDraft(state.messages) < MAX_AGENT_CALLS_PER_DRAFT - 1;
    let reply = await deps.model(
      [new SystemMessage(systemPrompt), ...state.messages],
      { allowTools },
      config,
    );
    if (!allowTools && toolCallsOf(reply).length > 0) {
      // A tool call without a tool result would break the next model call, so it is dropped.
      reply = new AIMessage({
        content: textOf(reply),
        response_metadata: reply.response_metadata,
        usage_metadata: reply.usage_metadata,
      });
    }
    const asksForTools = toolCallsOf(reply).length > 0;
    return {
      messages: [reply],
      // Text that comes with a tool call is not a draft.
      draftAnswer: asksForTools ? state.draftAnswer : textOf(reply),
      usage: {
        ...noUsage(),
        agent: {
          input: reply.usage_metadata?.input_tokens ?? 0,
          output: reply.usage_metadata?.output_tokens ?? 0,
        },
      },
    };
  };
}

function errorResult(call: { id: string; name: string }, message: string): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify({ ok: false, error: { kind: "tool_error", message } }),
    tool_call_id: call.id,
    name: call.name,
    status: "error",
  });
}

/**
 * The tools node: runs the tool calls of the last agent message, one after the other (a character
 * lookup may have to come before a search that uses it), and adds one result message per call.
 * The tools are built for the run's world.
 */
export function createToolsNode(deps: { toolsFor: (worldId: string) => AgentTool[] }) {
  return async (state: AgentStateType, config: RunnableConfig): Promise<AgentStateUpdate> => {
    const tools = new Map(deps.toolsFor(worldIdOf(config)).map((t) => [t.name, t]));
    const results: ToolMessage[] = [];
    for (const [index, call] of toolCallsOf(state.messages.at(-1)).entries()) {
      const id = call.id ?? `call_${index}`;
      const tool = tools.get(call.name);
      if (!tool) {
        results.push(errorResult({ id, name: call.name }, `Unknown tool: ${call.name}.`));
        continue;
      }
      try {
        const result = await tool.invoke({ ...call, id, type: "tool_call" }, config);
        results.push(
          ToolMessage.isInstance(result)
            ? result
            : new ToolMessage({ content: String(result), tool_call_id: id, name: call.name }),
        );
      } catch (error) {
        if (!(error instanceof ToolInputParsingException)) {
          console.error(`[agent] tool ${call.name} failed`, error);
        }
        results.push(
          errorResult(
            { id, name: call.name },
            error instanceof ToolInputParsingException
              ? `Invalid input for ${call.name}.`
              : `${call.name} failed.`,
          ),
        );
      }
    }
    return { messages: results };
  };
}

/**
 * The reflection node: a cheaper model checks the draft against the evidence of this run and
 * returns a verdict. A valid draft ends the run. An invalid one goes back to the agent with the
 * violations, until the revision limit is reached: then the best draft is kept and a caveat that
 * lists what is unresolved is added to it. The same happens when the run has already taken too
 * long to start another revision. A check that cannot run ends the run with a caveat.
 */
export function createReflectionNode(deps: {
  model: ReflectionModel;
  maxIterations: number;
  /** Milliseconds a run may last before it stops asking for revisions. */
  revisionCutoffMs?: number;
  /** The clock, so tests can move it. */
  now?: () => number;
}) {
  const cutoffMs = deps.revisionCutoffMs ?? REVISION_CUTOFF_MS;
  const now = deps.now ?? Date.now;
  return async (state: AgentStateType, config: RunnableConfig): Promise<AgentStateUpdate> => {
    const draft = state.draftAnswer;
    const { question, run } = splitCurrentRun(state.messages);

    let verdict;
    let spent: TokenUsage = { input: 0, output: 0 };
    if (draft.trim() === "") {
      // Nothing to check: no model call.
      verdict = invalidVerdict([
        { rule_id: RULE_EMPTY_ANSWER, explanation: "The answer is empty." },
      ]);
    } else {
      try {
        const result = await deps.model(buildReflectionMessages({ question, run, draft }), config);
        verdict = toVerdict(result.verdict);
        spent = result.usage ?? spent;
      } catch (error) {
        console.error("[agent] reflection failed", error);
        verdict = checkUnavailable();
      }
    }
    const usage = { ...noUsage(), reflection: spent };
    // A run that has taken too long keeps its best draft instead of starting another revision.
    const startedAt = config?.configurable?.startedAt;
    const tooLate = typeof startedAt === "number" && now() - startedAt > cutoffMs;

    if (verdict.valid) return { reflection: verdict, usage };
    if (isCheckUnavailable(verdict)) {
      return { reflection: verdict, draftAnswer: draft + caveatFor(verdict), usage };
    }
    if (state.iterations < deps.maxIterations && !tooLate) {
      return {
        reflection: verdict,
        iterations: state.iterations + 1,
        messages: [feedbackMessage(revisionRequest(verdict.violations))],
        usage,
      };
    }
    return { reflection: verdict, draftAnswer: draft + caveatFor(verdict), usage };
  };
}

/** After the agent: run its tool calls, or have the draft checked. */
export function routeAfterAgent(state: AgentStateType): "tools" | "reflect" {
  return toolCallsOf(state.messages.at(-1)).length > 0 ? "tools" : "reflect";
}

/**
 * After reflection: back to the agent only when the node just asked for a revision, which it
 * does by adding the feedback message. Everything else ends the run.
 */
export function routeAfterReflection(state: AgentStateType): "agent" | typeof END {
  const last = state.messages.at(-1);
  const revising =
    last !== undefined && isFeedbackMessage(last) && state.reflection?.valid === false;
  return revising ? "agent" : END;
}
