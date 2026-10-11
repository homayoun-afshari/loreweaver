import { END, START, StateGraph } from "@langchain/langgraph";
import { DEFAULT_MAX_ITERATIONS, recursionLimitFor } from "./config";
import {
  createAgentNode,
  createReflectionNode,
  createToolsNode,
  routeAfterAgent,
  routeAfterReflection,
  type AgentModel,
  type ReflectionModel,
} from "./nodes";
import { AgentState } from "./state";
import type { AgentTool } from "./tools";

export type AgentGraphDeps = {
  /** The drafting model. */
  agentModel: AgentModel;
  /** The model that checks drafts. */
  reflectionModel: ReflectionModel;
  /** The system prompt of the world a run belongs to. */
  systemPromptFor: (worldId: string) => string;
  /** The tools, scoped to the world a run belongs to. */
  toolsFor: (worldId: string) => AgentTool[];
  /** How many revisions a draft may get. */
  maxIterations?: number;
};

/**
 * The agent: START → agent, then
 *  - agent → tools → agent while the model asks for tools,
 *  - agent → reflection once it has written a draft,
 *  - reflection → END when the draft is valid, the revision limit is reached or the check was
 *    unavailable, and reflection → agent otherwise.
 *
 * The graph knows nothing about HTTP, React or the AI SDK (see ADR-0004). A run needs the world
 * in its configuration: `graph.invoke({ messages }, agentRunConfig(worldId))`.
 */
export function createAgentGraph(deps: AgentGraphDeps) {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return new StateGraph(AgentState)
    .addNode(
      "agent",
      createAgentNode({ model: deps.agentModel, systemPromptFor: deps.systemPromptFor }),
    )
    .addNode("tools", createToolsNode({ toolsFor: deps.toolsFor }))
    .addNode("reflect", createReflectionNode({ model: deps.reflectionModel, maxIterations }))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, ["tools", "reflect"])
    .addEdge("tools", "agent")
    .addConditionalEdges("reflect", routeAfterReflection, ["agent", END])
    .compile()
    .withConfig({ recursionLimit: recursionLimitFor(maxIterations) });
}

export type AgentGraph = ReturnType<typeof createAgentGraph>;
