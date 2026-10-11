import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { charactersOf } from "../apps/web/src/lib/worlds";
import { parseAgentPrompts } from "./agent-prompts";

const good = {
  id: "fire-escape-01",
  input: "Aria Voss is trapped in the Ice Citadel.",
  character_id: 1,
  world_id: "world_aethel",
  expected_tools: ["fetch_character_state"],
  tempts_rule_break: false,
  tags: ["rule"],
  note: "What is right, and why.",
};

describe("parseAgentPrompts", () => {
  it("reads a valid set", () => {
    expect(parseAgentPrompts(JSON.stringify([good]))).toHaveLength(1);
  });

  it("lists every problem, with the field", () => {
    const bad = { ...good, id: "Bad Id", expected_tools: ["delete_world"], tags: [] };
    expect(() => parseAgentPrompts(JSON.stringify([bad]))).toThrow(/0\.id/);
    expect(() => parseAgentPrompts(JSON.stringify([bad]))).toThrow(/0\.expected_tools/);
    expect(() => parseAgentPrompts(JSON.stringify([bad]))).toThrow(/0\.tags/);
  });

  it("rejects an unknown field, a duplicate id and text that is not JSON", () => {
    expect(() => parseAgentPrompts(JSON.stringify([{ ...good, extra: 1 }]))).toThrow(/invalid/);
    expect(() => parseAgentPrompts(JSON.stringify([good, good]))).toThrow(/duplicate id/);
    expect(() => parseAgentPrompts("{nope")).toThrow(/not valid JSON/);
  });
});

describe("the real prompt set (evals/agent-prompts.json)", () => {
  const path = fileURLToPath(new URL("./agent-prompts.json", import.meta.url));
  const load = async () => parseAgentPrompts(await readFile(path, "utf8"));

  it("has ten valid prompts, and at least half of them tempt a rule break", async () => {
    const prompts = await load();
    expect(prompts).toHaveLength(10);
    expect(prompts.filter((p) => p.tempts_rule_break).length).toBeGreaterThanOrEqual(5);
  });

  it("asks about real characters, in the world they belong to, and names them in the question", async () => {
    for (const prompt of await load()) {
      const character = charactersOf(prompt.world_id).find((c) => c.id === prompt.character_id);
      expect(
        character,
        `${prompt.id}: character ${prompt.character_id} in ${prompt.world_id}`,
      ).toBeDefined();
      expect(prompt.input, prompt.id).toContain(character!.name);
    }
  });

  it("covers both worlds, a lore question, a state-only question and a cross-world request", async () => {
    const prompts = await load();
    expect(new Set(prompts.map((p) => p.world_id)).size).toBe(2);
    expect(prompts.some((p) => p.expected_tools.length === 1)).toBe(true);
    expect(prompts.some((p) => p.tags.includes("isolation"))).toBe(true);
    expect(prompts.some((p) => p.tags.includes("conflict"))).toBe(true);
  });
});
