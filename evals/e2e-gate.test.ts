import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseE2eDataset } from "./e2e-dataset";
import { evaluateGate, parseThreshold } from "./e2e-gate";

const summary = (over: Partial<Parameters<typeof evaluateGate>[0]> = {}) => ({
  cases: 10,
  failedIds: [] as string[],
  runErrors: 0,
  judgeErrors: 0,
  faithfulness: { mean: 4.8 as number | undefined, graded: 10, atLeast4: 10 },
  ...over,
});

describe("evaluateGate", () => {
  it("is inactive, and passes, when no rule is set", () => {
    expect(evaluateGate(summary({ failedIds: ["a-01"] }), {})).toEqual({
      active: false,
      pass: true,
      reasons: [],
    });
  });

  it("passes when the mean faithfulness reaches the threshold", () => {
    expect(evaluateGate(summary(), { minFaithfulness: 4.5 })).toMatchObject({
      active: true,
      pass: true,
    });
    expect(
      evaluateGate(summary({ faithfulness: { mean: 4.5, graded: 10, atLeast4: 9 } }), {
        minFaithfulness: 4.5,
      }).pass,
    ).toBe(true);
  });

  it("fails below the threshold and says by how much it was missed", () => {
    const result = evaluateGate(summary({ faithfulness: { mean: 3.9, graded: 10, atLeast4: 5 } }), {
      minFaithfulness: 4.5,
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(["mean faithfulness 3.90 is below the threshold 4.5"]);
  });

  it("does not look at which cases failed unless every case is required to pass", () => {
    expect(evaluateGate(summary({ failedIds: ["a-01"] }), { minFaithfulness: 4 }).pass).toBe(true);
    const result = evaluateGate(summary({ failedIds: ["a-01", "b-02"] }), { requireAll: true });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(["case(s) failed: a-01, b-02"]);
  });

  it("fails a run it could not grade", () => {
    expect(evaluateGate(summary({ runErrors: 1 }), { minFaithfulness: 4 }).reasons).toEqual([
      "1 run(s) failed",
    ]);
    expect(evaluateGate(summary({ judgeErrors: 2 }), { requireAll: true }).reasons).toEqual([
      "2 judge error(s)",
    ]);
    const blind = evaluateGate(
      summary({ faithfulness: { mean: undefined, graded: 0, atLeast4: 0 } }),
      { minFaithfulness: 4 },
    );
    expect(blind.reasons).toEqual(["no case was graded, so the faithfulness is unknown"]);
    expect(evaluateGate(summary({ cases: 0 }), { requireAll: true }).pass).toBe(false);
  });

  it("lists every reason at once", () => {
    const result = evaluateGate(
      summary({
        failedIds: ["a-01"],
        runErrors: 1,
        faithfulness: { mean: 2, graded: 9, atLeast4: 2 },
      }),
      { minFaithfulness: 4, requireAll: true },
    );
    expect(result.reasons).toHaveLength(3);
  });
});

describe("parseThreshold", () => {
  it("reads a score from 1 to 5, and nothing as nothing", () => {
    expect(parseThreshold("--min-faithfulness", "4.5")).toBe(4.5);
    expect(parseThreshold("--min-faithfulness", undefined)).toBeUndefined();
  });

  it("refuses a value that is not a score, naming the flag", () => {
    expect(() => parseThreshold("--min-faithfulness", "good")).toThrow(/--min-faithfulness/);
    expect(() => parseThreshold("--faithfulness-pass", "6")).toThrow(/1 to 5/);
    expect(() => parseThreshold("--faithfulness-pass", "0")).toThrow(/1 to 5/);
  });
});

describe("evals/datasets/smoke.json", async () => {
  const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const ids = JSON.parse(await read("./datasets/smoke.json")) as string[];
  const cases = parseE2eDataset(await read("./datasets/e2e.json"));

  it("lists 10 distinct cases of the end-to-end set", () => {
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids)
      expect(
        cases.some((c) => c.id === id),
        id,
      ).toBe(true);
  });

  it("holds only cases that depend on the lore, so a prompt that invents canon shows in the mean", () => {
    // Cases about a character's state, a missing character or a service that is down are answered
    // well whatever the prompt says about the lore, and they only hide a drop in the mean.
    const chosen = cases.filter((c) => ids.includes(c.id));
    for (const c of chosen) expect(c.expected_tools, c.id).toContain("search_lore");
  });

  it("covers both worlds and a conflict in the lore", () => {
    const chosen = cases.filter((c) => ids.includes(c.id));
    expect(new Set(chosen.map((c) => c.world_id))).toEqual(new Set(["world_aethel", "world_nox"]));
    expect(chosen.some((c) => c.tags.includes("conflict"))).toBe(true);
  });
});
