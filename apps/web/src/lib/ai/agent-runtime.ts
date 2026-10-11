import {
  createAgentGraph,
  createAgentModel,
  createAgentTools,
  createReflectionModel,
  type AgentGraph,
} from "@/lib/agent";
import { getEnv } from "@/lib/env";
import { getSystemPrompt } from "@/lib/prompts";
import type { ModelId } from "./models";

const graphs = new Map<ModelId, AgentGraph>();

/**
 * The agent graph with the real models, tools and prompts, for the drafting model of one request.
 * One graph per model is kept for the life of the process: the world arrives with each run, so a
 * graph is never tied to a visitor. Server-side only.
 */
export function getAgentGraph(modelId: ModelId): AgentGraph {
  let graph = graphs.get(modelId);
  if (!graph) {
    const env = getEnv();
    graph = createAgentGraph({
      agentModel: createAgentModel({ apiKey: env.ANTHROPIC_API_KEY, modelId }),
      reflectionModel: createReflectionModel({ apiKey: env.ANTHROPIC_API_KEY }),
      systemPromptFor: getSystemPrompt,
      toolsFor: (worldId) => createAgentTools({ worldId }),
      maxIterations: env.AGENT_MAX_ITERATIONS,
    });
    graphs.set(modelId, graph);
  }
  return graph;
}
