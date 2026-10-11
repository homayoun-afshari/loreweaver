import { tool, type InferUITools } from "ai";
import {
  createToolHandlers,
  FETCH_CHARACTER_STATE_DESCRIPTION,
  fetchCharacterStateInput,
  SEARCH_LORE_DESCRIPTION,
  searchLoreInput,
  type ToolDeps,
} from "./tool-core";

export type { FetchCharacterStateOutput, SearchLoreOutput, ToolDeps } from "./tool-core";

/**
 * The tools the chat route gives to the AI SDK. Server-side only: `execute` runs on our server and
 * the model never touches the legacy CMS or the database directly. The work itself is in
 * `tool-core.ts`, which the agent graph shares.
 */
export function createTools(deps: ToolDeps) {
  const handlers = createToolHandlers(deps);
  return {
    fetch_character_state: tool({
      description: FETCH_CHARACTER_STATE_DESCRIPTION,
      inputSchema: fetchCharacterStateInput,
      execute: handlers.fetchCharacterState,
    }),

    search_lore: tool({
      description: SEARCH_LORE_DESCRIPTION,
      inputSchema: searchLoreInput,
      execute: handlers.searchLore,
    }),
  };
}

/** The tool types, shared with the browser so tool parts are typed there too (type-only import). */
export type ChatTools = InferUITools<ReturnType<typeof createTools>>;
