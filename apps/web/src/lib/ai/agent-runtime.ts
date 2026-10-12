import {
  createAgentGraph,
  createAgentModel,
  createAgentTools,
  createReflectionModel,
  type AgentGraph,
} from "@/lib/agent";
import { getEnv } from "@/lib/env";
import { getSystemPrompt } from "@/lib/prompts";
import type { ToolDeps } from "./tool-core";
import type { ModelId } from "./models";

const graphs = new Map<ModelId, AgentGraph>();

/**
 * A new agent graph with the real models, tools and prompts. `toolDeps` replaces parts of what the
 * tools use (for example the legacy client, so the eval can play a service that is down). Server-side
 * only.
 */
export function createRuntimeGraph(
  modelId: ModelId,
  toolDeps: Omit<ToolDeps, "worldId"> = {},
): AgentGraph {
  const env = getEnv();
  return createAgentGraph({
    agentModel: createAgentModel({ apiKey: env.ANTHROPIC_API_KEY, modelId }),
    reflectionModel: createReflectionModel({ apiKey: env.ANTHROPIC_API_KEY }),
    systemPromptFor: getSystemPrompt,
    toolsFor: (worldId) => createAgentTools({ worldId, ...toolDeps }),
    maxIterations: env.AGENT_MAX_ITERATIONS,
  });
}

/**
 * The agent graph with the real models, tools and prompts, for the drafting model of one request.
 * One graph per model is kept for the life of the process: the world arrives with each run, so a
 * graph is never tied to a visitor. Server-side only.
 */
export function getAgentGraph(modelId: ModelId): AgentGraph {
  let graph = graphs.get(modelId);
  if (!graph) {
    graph = createRuntimeGraph(modelId);
    graphs.set(modelId, graph);
  }
  return graph;
}
