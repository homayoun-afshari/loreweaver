import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The system prompt lives in a versioned file, not in code, so it can be reviewed, diffed and
 * compared like any other change. To change it, copy `agent.v1.md` to `agent.v2.md`, edit the
 * copy and change this constant. Old versions stay in the repo.
 */
export const PROMPT_VERSION = "agent.v1";

let cached: string | undefined;

/** The system prompt text. Server-side only: it is read from disk once per process. */
export function getSystemPrompt(): string {
  cached ??= readFileSync(
    path.join(process.cwd(), "src", "lib", "prompts", `${PROMPT_VERSION}.md`),
    "utf8",
  ).trim();
  return cached;
}
