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

  it("keeps the fields of the red-team cases and asks for a size when a limit rejects the case", () => {
    const c = {
      ...good,
      must_not_contain: ["CANARY-7f3a"],
      max_answer_chars: 1500,
      tags: ["injection"],
    };
    expect(parseE2eDataset(JSON.stringify([c]))[0].must_not_contain).toEqual(["CANARY-7f3a"]);
    const limit = { ...good, rejected_by: "input-limit", tags: ["limits"] };
    expect(() => parseE2eDataset(JSON.stringify([limit]))).toThrow(/needs pad_input_to/);
    expect(parseE2eDataset(JSON.stringify([{ ...limit, pad_input_to: 20000 }]))).toHaveLength(1);
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

describe("evals/datasets/redteam.json", async () => {
  const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const cases = parseE2eDataset(await read("./datasets/redteam.json"));

  it("has 6 to 9 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.length).toBeLessThanOrEqual(9);
  });

  it("covers every kind of attack the set is meant to test", () => {
    const tags = new Set(cases.flatMap((c) => c.tags));
    for (const tag of ["injection", "cross-world", "harmful", "legit-dark", "cost-attack"]) {
      expect(tags.has(tag as never), tag).toBe(true);
    }
    // Over-refusal is a rate, so it needs more than one legitimate dark request.
    expect(cases.filter((c) => c.tags.includes("legit-dark")).length).toBeGreaterThanOrEqual(2);
  });

  it("starts the constraints of every legitimate dark request with the one about not refusing", () => {
    // The over-refusal rate reads the first constraint (see summarizeResults).
    for (const c of cases.filter((x) => x.tags.includes("legit-dark"))) {
      expect(c.expected_constraints[0], c.id).toMatch(/does not refuse/i);
    }
  });

  it("puts every case in a known world or in the fixture world of the indirect injection", () => {
    for (const c of cases) {
      expect(isKnownWorld(c.world_id) || c.world_id === "world_redteam", c.id).toBe(true);
    }
    const indirect = cases.find((c) => c.world_id === "world_redteam");
    expect(indirect?.must_not_contain).toContain("CANARY-7f3a");
  });

  it("asks about the other world with words only that world's lore contains", () => {
    const cross = cases.find((c) => c.id === "cross-world-03");
    expect(cross?.world_id).toBe("world_aethel");
    expect(cross?.must_not_contain?.length).toBeGreaterThanOrEqual(5);
  });

  it("has a case for the input limit and a case for the length of an answer", () => {
    expect(cases.some((c) => c.rejected_by === "input-limit")).toBe(true);
    expect(cases.some((c) => c.max_answer_chars !== undefined)).toBe(true);
  });
});
