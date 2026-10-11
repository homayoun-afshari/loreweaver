import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  createToolHandlers,
  FETCH_CHARACTER_STATE_DESCRIPTION,
  fetchCharacterStateInput,
  SEARCH_LORE_DESCRIPTION,
  searchLoreInput,
  type ToolDeps,
} from "@/lib/ai/tool-core";

export type AgentTool = StructuredToolInterface;

/**
 * What the drafting model is told about the tools: names, descriptions and input schemas, with no
 * code and no world. The model asks; the server decides what runs (see `createAgentTools`).
 */
export const TOOL_SPECS = [
  {
    name: "fetch_character_state",
    description: FETCH_CHARACTER_STATE_DESCRIPTION,
    schema: fetchCharacterStateInput,
  },
  { name: "search_lore", description: SEARCH_LORE_DESCRIPTION, schema: searchLoreInput },
] as const;

/**
 * The two tools as LangChain tools, scoped to one world. They run the same handlers as the chat
 * route's tools. The result goes back to the model as JSON text, like a failure does: failures are
 * data, so the agent can say "unavailable" instead of guessing.
 */
export function createAgentTools(deps: ToolDeps): AgentTool[] {
  const handlers = createToolHandlers(deps);
  const [fetchSpec, searchSpec] = TOOL_SPECS;
  return [
    tool(async (input) => JSON.stringify(await handlers.fetchCharacterState(input)), fetchSpec),
    tool(async (input) => JSON.stringify(await handlers.searchLore(input)), searchSpec),
  ];
}
