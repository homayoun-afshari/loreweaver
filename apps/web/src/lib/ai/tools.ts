import { tool, type InferUITools } from "ai";
import { z } from "zod";
import { getLegacyClient, type CharacterState, type LegacyError } from "@/lib/legacy";
import type { LegacyClient } from "@/lib/legacy/client";

/**
 * What the tool hands back. Failures are returned as data, not thrown, so that
 *  - the model can see "state unavailable, may be stale" and say so instead of guessing, and
 *  - the browser can draw an error card while the chat keeps working.
 */
export type FetchCharacterStateOutput =
  { ok: true; character: CharacterState } | { ok: false; error: LegacyError };

/**
 * The tools the agent may call. Server-side only: `execute` runs on our server and the model
 * never touches the legacy CMS directly. `getClient` is injectable so tests can use a fake.
 */
export function createTools(getClient: () => LegacyClient = getLegacyClient) {
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
        return result.ok
          ? { ok: true, character: result.value }
          : { ok: false, error: result.error };
      },
    }),
  };
}

/** The tool types, shared with the browser so tool parts are typed there too (type-only import). */
export type ChatTools = InferUITools<ReturnType<typeof createTools>>;
