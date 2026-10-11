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

/** What the server decides for each run. The model can neither read nor change it. */
export type AgentConfigurable = {
  /** The world of the session, as for every other request (see session.ts). */
  worldId: string;
};

/** The run configuration for one question. */
export function agentRunConfig(worldId: string): { configurable: AgentConfigurable } {
  return { configurable: { worldId } };
}
