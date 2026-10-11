import { z } from "zod";

/**
 * The agent prompt set (evals/agent-prompts.json): questions about the seeded characters, most of
 * them written to tempt the agent into breaking a rule of the world. They are run through the
 * agent graph without a browser, and the results show how often a first draft breaks a rule and
 * how often the reflection step catches it.
 *
 *   { "id": "no-flint-02", "input": "...", "character_id": 2, "world_id": "world_aethel",
 *     "expected_tools": ["fetch_character_state", "search_lore"], "tempts_rule_break": true,
 *     "tags": ["rule", "inventory", "trap"], "note": "why it is in the set, and what is right" }
 */
export const PROMPT_TAGS = [
  "happy-path", // nothing is wrong with the request
  "rule", // a rule of the world decides the answer
  "numeric", // a number (mana, a price) decides the answer
  "inventory", // what the character carries decides the answer
  "state", // only the live state is asked for
  "conflict", // the lore or the data disagree with themselves
  "isolation", // the request reaches into another world
  "trap", // the request, or an old figure, invites a wrong answer
] as const;

export const TOOL_NAMES = ["fetch_character_state", "search_lore"] as const;

const promptSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*-\d{2}$/, 'must look like "fire-escape-01"'),
  input: z.string().min(10),
  /** The character the question is about, by CMS id. */
  character_id: z.number().int().positive(),
  /** The world the question is asked in. */
  world_id: z.string().min(1),
  /** The tools a good run is expected to use (in any order). */
  expected_tools: z.array(z.enum(TOOL_NAMES)).min(1),
  /** True when the request invites the agent to break a rule or use something not owned. */
  tempts_rule_break: z.boolean(),
  tags: z.array(z.enum(PROMPT_TAGS)).min(1),
  /** What is right, and what makes the question hard. Written for the person reading the set. */
  note: z.string().min(10),
});

export type AgentPrompt = z.infer<typeof promptSchema>;

/** Reads and validates the prompt set. Throws one readable error listing every problem. */
export function parseAgentPrompts(json: string): AgentPrompt[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("agent-prompts.json: not valid JSON");
  }
  const result = z.array(promptSchema).safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`agent-prompts.json is invalid:\n${problems}`);
  }
  const ids = new Set<string>();
  for (const prompt of result.data) {
    if (ids.has(prompt.id)) throw new Error(`agent-prompts.json: duplicate id "${prompt.id}"`);
    ids.add(prompt.id);
  }
  return result.data;
}
