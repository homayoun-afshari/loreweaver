import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { charactersOf, isKnownWorld } from "../apps/web/src/lib/worlds";
import { parseAgentPrompts } from "./agent-prompts";
import { parseE2eDataset } from "./e2e-dataset";

const good = {
  id: "fire-escape-01",
  input: "Suggest an escape that uses fire magic.",
  character_id: 1,
  world_id: "world_aethel",
  expected_constraints: ["Says fire magic needs flint inside the Citadel"],
  expected_tools: ["search_lore"],
  tags: ["happy-path"],
  note: "Why this case is in the set.",
};

describe("parseE2eDataset", () => {
  it("reads a valid set", () => {
    expect(parseE2eDataset(JSON.stringify([good]))).toHaveLength(1);
  });

  it("accepts a case with no character and no expected tool", () => {
    const c = { ...good, id: "off-topic-02", character_id: null, expected_tools: [] };
    expect(parseE2eDataset(JSON.stringify([c]))).toHaveLength(1);
  });

  it("lists every problem in one error", () => {
    const bad = [{ ...good, id: "one", expected_constraints: [], tags: ["nonsense"] }];
    const run = () => parseE2eDataset(JSON.stringify(bad));
    expect(run).toThrow(/0\.id/);
    expect(run).toThrow(/expected_constraints/);
    expect(run).toThrow(/tags/);
  });

  it("rejects an unknown field, a duplicate id and not JSON", () => {
    expect(() => parseE2eDataset(JSON.stringify([{ ...good, extra: 1 }]))).toThrow(/invalid/);
    expect(() => parseE2eDataset(JSON.stringify([good, good]))).toThrow(/duplicate id/);
    expect(() => parseE2eDataset("{nope")).toThrow(/not valid JSON/);
  });

  it("rejects a tool that is both expected and forbidden", () => {
    const c = { ...good, forbidden_tools: ["search_lore"] };
    expect(() => parseE2eDataset(JSON.stringify([c]))).toThrow(/both expects and forbids/);
  });
});

describe("evals/datasets/e2e.json", async () => {
  const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const cases = parseE2eDataset(await read("./datasets/e2e.json"));

  it("has 15 to 20 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.length).toBeLessThanOrEqual(20);
  });

  it("asks every case in a known world, about a character of that world", () => {
    for (const c of cases) {
      expect(isKnownWorld(c.world_id), c.id).toBe(true);
      if (c.character_id === null) continue;
      const ids = charactersOf(c.world_id).map((x) => x.id);
      // A case about another world's character is allowed only when it tests that on purpose.
      if (!c.tags.includes("isolation")) expect(ids, c.id).toContain(c.character_id);
    }
  });

  it("keeps the ten Day 4 prompts as they are", async () => {
    const prompts = parseAgentPrompts(await read("./agent-prompts.json"));
    for (const p of prompts) {
      const c = cases.find((x) => x.id === p.id);
      expect(c, p.id).toBeDefined();
      expect(c).toMatchObject({
        input: p.input,
        character_id: p.character_id,
        world_id: p.world_id,
        expected_tools: p.expected_tools,
      });
    }
  });

  it("covers the edge cases the guide asks for", () => {
    const tags = new Set(cases.flatMap((c) => c.tags));
    for (const tag of [
      "happy-path",
      "conflict",
      "missing-character",
      "service-down",
      "off-topic",
    ]) {
      expect(tags.has(tag as never), tag).toBe(true);
    }
    expect(cases.some((c) => c.legacy === "down")).toBe(true);
  });
});
