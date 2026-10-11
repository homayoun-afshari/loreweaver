import { readFileSync } from "node:fs";
import path from "node:path";
import { charactersOf } from "@/lib/worlds";

/**
 * The system prompt lives in a versioned file, not in code, so it can be reviewed, diffed and
 * compared like any other change. To change it, copy the latest version to a new file, edit the
 * copy and change this constant. Old versions stay in the repo.
 */
export const PROMPT_VERSION = "agent.v3";

let cachedTemplate: string | undefined;

/**
 * The system prompt for one world. Server-side only. The file is read from disk once per process.
 * It is a template: {{known_characters}} is replaced with the characters of THIS world only, so
 * the model is never told the names (or ids) of another world's characters.
 */
export function getSystemPrompt(worldId: string): string {
  cachedTemplate ??= readFileSync(
    path.join(process.cwd(), "src", "lib", "prompts", `${PROMPT_VERSION}.md`),
    "utf8",
  ).trim();
  const characters = charactersOf(worldId);
  const list =
    characters.length === 0 ? "none" : characters.map((c) => `${c.id} = ${c.name}`).join(", ");
  return cachedTemplate.replace("{{known_characters}}", list);
}
