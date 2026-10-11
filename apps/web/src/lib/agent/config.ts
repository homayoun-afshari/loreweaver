/**
 * The bounds of the agent. Every loop in the graph is limited, and the limits are written here
 * so a test can prove the worst case ends (see docs/AGENT_DESIGN.md).
 */

/** How many times a draft may be sent back for a revision when nothing else is configured. */
export const DEFAULT_MAX_ITERATIONS = 2;

/**
 * Model calls allowed for ONE draft. Calls that ask for tools use all but the last one; the last
 * call has no tools, so the model has to write the answer. This replaces the AI SDK's step limit.
 */
export const MAX_AGENT_CALLS_PER_DRAFT = 3;

/** Added to the instructions of the last model call of a draft, which has no tools. */
export const NO_MORE_TOOLS_NOTE =
  "You cannot call any more tools for this answer. Write the answer now from the results you " +
  "already have. If something is still missing, say what could not be looked up.";

/**
 * The most graph steps one draft can take: every model call, the tool round after each call that
 * asked for tools (all but the last), and one reflection.
 */
export const MAX_STEPS_PER_DRAFT = MAX_AGENT_CALLS_PER_DRAFT + (MAX_AGENT_CALLS_PER_DRAFT - 1) + 1;

/**
 * LangGraph's own limit on steps per run is a safety net, not the exit: it fails the run with an
 * error. It is set from the worst case (a first draft plus every revision, each at its most steps),
 * so a legitimate run never reaches it and the revision limit always ends the run first.
 */
export function recursionLimitFor(maxIterations: number): number {
  return (maxIterations + 1) * MAX_STEPS_PER_DRAFT + 1;
}

/**
 * A run that is older than this does not start another revision: it keeps the best draft and adds
 * the caveat. A revision takes several model calls, and the function that runs the chat is stopped
 * by the host at 30 seconds, which would cut the stream and leave the author with nothing.
 */
export const REVISION_CUTOFF_MS = 12_000;

/** What the server decides for each run. The model can neither read nor change it. */
export type AgentConfigurable = {
  /** The world of the session, as for every other request (see session.ts). */
  worldId: string;
  /** When the request started, in milliseconds since 1970, for the revision cutoff. */
  startedAt?: number;
};

/** What a trace is filtered and compared by: the setup that produced the answer. */
export type TraceLabels = {
  /** The version of the drafting prompt (see prompts/index.ts). */
  promptVersion: string;
  /** The drafting model. */
  modelId: string;
  /** VERCEL_ENV: "preview" or "production" in the cloud, unset locally. */
  vercelEnv: string | undefined;
};

/** The environment label of a trace: "development" on a developer's machine. */
export function traceEnv(vercelEnv: string | undefined): "development" | "preview" | "production" {
  return vercelEnv === "preview" || vercelEnv === "production" ? vercelEnv : "development";
}

/**
 * The run configuration for one question. With labels, every run of the trace (the graph, its
 * nodes, the model calls) carries `prompt_version`, `model` and `env` as metadata in LangSmith.
 */
export function agentRunConfig(
  worldId: string,
  startedAt: number = Date.now(),
  labels?: TraceLabels,
): { configurable: AgentConfigurable; metadata?: Record<string, string> } {
  const configurable = { worldId, startedAt };
  if (!labels) return { configurable };
  return {
    configurable,
    metadata: {
      prompt_version: labels.promptVersion,
      model: labels.modelId,
      env: traceEnv(labels.vercelEnv),
    },
  };
}
