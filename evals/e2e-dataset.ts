import { z } from "zod";
import { PROMPT_TAGS, TOOL_NAMES } from "./agent-prompts";

/**
 * The end-to-end eval set (evals/datasets/e2e.json): questions asked of the whole agent, each with
 * the constraints a good answer must satisfy. The first ten cases are the Day 4 prompts
 * (evals/agent-prompts.json) with constraints added; the others cover edges that set does not:
 * a rule exception, a missing character, a missing lore passage, a legacy service that is down and
 * an off-topic request.
 *
 *   { "id": "fire-escape-01", "input": "...", "character_id": 1, "world_id": "world_aethel",
 *     "expected_constraints": ["Says ..."], "expected_tools": ["fetch_character_state"],
 *     "tags": ["happy-path"], "note": "why it is in the set, and what is right" }
 *
 * `expected_constraints` are graded by the judge. `expected_tools` and `forbidden_tools` are
 * checked by code. The inventory and the citations are checked by code for every case.
 */
export const E2E_TAGS = [
  ...PROMPT_TAGS,
  "edge", // a rule exception or a limit case
  "missing-character", // the character does not exist
  "missing-lore", // the lore does not cover the question
  "service-down", // the legacy service fails
  "off-topic", // nothing to do with the world
] as const;

const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*-\d{2}$/, 'must look like "fire-escape-01"'),
  input: z.string().min(10),
  /** The character the question is about, by CMS id, or null when it is about no character. */
  character_id: z.number().int().positive().nullable(),
  /** The world the question is asked in. */
  world_id: z.string().min(1),
  /** "down" replaces the legacy service with one that always fails. Default "up". */
  legacy: z.enum(["up", "down"]).optional(),
  /** What a good answer says or does, one checkable sentence each. Graded by the judge. */
  expected_constraints: z.array(z.string().min(10)).min(1),
  /** The tools a good run calls (in any order). Can be empty. */
  expected_tools: z.array(z.enum(TOOL_NAMES)),
  /** The tools a good run does not call. */
  forbidden_tools: z.array(z.enum(TOOL_NAMES)).optional(),
  /** Items the request invites that nobody in the CMS carries (they join the items to look for). */
  tempting_items: z.array(z.string().min(2)).optional(),
  tags: z.array(z.enum(E2E_TAGS)).min(1),
  /** What is right, and what makes the question hard. Written for the person reading the set. */
  note: z.string().min(10),
});

export type E2eCase = z.infer<typeof caseSchema>;

/** Reads and validates the eval set. Throws one readable error listing every problem. */
export function parseE2eDataset(json: string): E2eCase[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("e2e.json: not valid JSON");
  }
  const result = z.array(caseSchema).safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`e2e.json is invalid:\n${problems}`);
  }
  const ids = new Set<string>();
  for (const c of result.data) {
    if (ids.has(c.id)) throw new Error(`e2e.json: duplicate id "${c.id}"`);
    ids.add(c.id);
    const both = (c.forbidden_tools ?? []).filter((t) => c.expected_tools.includes(t));
    if (both.length > 0) {
      throw new Error(`e2e.json: ${c.id} both expects and forbids ${both.join(", ")}`);
    }
  }
  return result.data;
}
