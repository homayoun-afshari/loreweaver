import { tool, type InferUITools } from "ai";
import { z } from "zod";
import { getLegacyClient, type CharacterState, type LegacyError } from "@/lib/legacy";
import type { LegacyClient } from "@/lib/legacy/client";
import {
  createLoreSearch,
  DEFAULT_TOP_K,
  MAX_TOP_K,
  type SearchLoreArgs,
  type SearchLoreOutput,
} from "@/lib/rag/search";

/**
 * What the tool hands back. Failures are returned as data, not thrown, so that
 *  - the model can see "state unavailable, may be stale" and say so instead of guessing, and
 *  - the browser can draw an error card while the chat keeps working.
 */
export type FetchCharacterStateOutput =
  { ok: true; character: CharacterState } | { ok: false; error: LegacyError };

export type { SearchLoreOutput } from "@/lib/rag/search";

/** What the tools need from the request and from the outside world. */
export type ToolDeps = {
  /**
   * The world of the signed-in author, decided by the server from the session (see session.ts).
   * Tools are built per request with it, and the model can neither see nor change it.
   */
  worldId: string;
  /** Injectable so tests can use fakes. */
  getClient?: () => LegacyClient;
  searchLore?: (args: SearchLoreArgs) => Promise<SearchLoreOutput>;
};

/**
 * The tools the agent may call. Server-side only: `execute` runs on our server and the model
 * never touches the legacy CMS or the database directly.
 */
export function createTools({
  worldId,
  getClient = getLegacyClient,
  searchLore = createLoreSearch(),
}: ToolDeps) {
  return {
    fetch_character_state: tool({
      description:
        "Get the current state of ONE character from the author's story CMS: location, mana, " +
        "health, condition and inventory. Call it whenever the author asks where a character is, " +
        "what they carry, or about their mana or health. Never guess these values.",
      inputSchema: z.object({
        character_id: z
          .string()
          .describe('The numeric id of the character, written as a string, for example "4".'),
      }),
      execute: async ({ character_id }): Promise<FetchCharacterStateOutput> => {
        const id = character_id.trim();
        // The model chooses this argument, so check it instead of trusting it.
        if (!/^\d+$/.test(id)) {
          return {
            ok: false,
            error: { kind: "not_found", message: "character_id must be a numeric id." },
          };
        }
        const result = await getClient().getCharacterState(Number(id));
        if (!result.ok) return { ok: false, error: result.error };
        // The legacy CMS knows every world, and the model chose the id. A character of another
        // world must look exactly like a character that does not exist: same error, same message,
        // so the answer cannot even be used to find out that the character exists.
        if (result.value.worldId !== worldId) {
          return { ok: false, error: { kind: "not_found", message: "Character not found." } };
        }
        return { ok: true, character: result.value };
      },
    }),

    search_lore: tool({
      description:
        "Search the author's LORE: the written canon of their world (rules of magic, places, " +
        "history, factions, character backstories). Returns the best-matching passages, each with " +
        "a citation id, its source file and its heading. Use it for any question about how the " +
        "world works, what a place is, what happened, or who someone is in the background. It " +
        "does NOT know where a character is or what they carry now: use fetch_character_state " +
        "for that. The search is already limited to the author's world; there is no world parameter.",
      // There is deliberately no world field here. Whatever the model sends beyond these two
      // fields is dropped by the schema, and the world below comes from the session.
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "What to look for, as a short question or phrase. Keep the key names and terms, " +
              'for example "fire magic Ice Citadel flint".',
          ),
        k: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOP_K)
          .optional()
          .describe(`How many passages to return. Default ${DEFAULT_TOP_K}.`),
      }),
      execute: ({ query, k }): Promise<SearchLoreOutput> => searchLore({ worldId, query, k }),
    }),
  };
}

/** The tool types, shared with the browser so tool parts are typed there too (type-only import). */
export type ChatTools = InferUITools<ReturnType<typeof createTools>>;
