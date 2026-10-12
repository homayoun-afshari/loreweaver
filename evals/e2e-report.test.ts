import { describe, expect, it } from "vitest";
import type { JudgeGrade } from "./e2e-judge";
import { decide, summarizeResults, type CaseChecks, type CaseResult } from "./e2e-report";

const okChecks: CaseChecks = {
  tools: { pass: true, missing: [], forbiddenCalled: [] },
  inventory: { pass: true, ownedMentioned: [], notOwned: [] },
  citations: { pass: true, cited: [], unresolved: [], notRetrieved: [] },
};
const grade = (faithfulness: number, passes: boolean[] = [true]): JudgeGrade => ({
  reasoning: "r",
  faithfulness,
  constraints: passes.map((pass, i) => ({ constraint: `c${i}`, pass })),
  judgePass: true,
  pass: faithfulness >= 4 && passes.every(Boolean),
});

describe("decide", () => {
  it("passes when the checks hold and the judge passes", () => {
    expect(decide({ checks: okChecks, judge: grade(5), judged: true })).toEqual({
      pass: true,
      failures: [],
    });
  });

  it("fails on each check with a reason", () => {
    const checks: CaseChecks = {
      tools: { pass: false, missing: ["search_lore"], forbiddenCalled: ["fetch_character_state"] },
      inventory: { pass: false, ownedMentioned: [], notOwned: ["rope"] },
      citations: { pass: false, cited: ["deadbeef"], unresolved: ["deadbeef"], notRetrieved: [] },
    };
    const { pass, failures } = decide({ checks, judge: grade(5), judged: true });
    expect(pass).toBe(false);
    expect(failures).toEqual([
      "tool not called: search_lore",
      "forbidden tool called: fetch_character_state",
      "item not carried: rope",
      "unresolved citation: deadbeef",
    ]);
  });

  it("fails on low faithfulness and on a failed constraint", () => {
    expect(decide({ checks: okChecks, judge: grade(3), judged: true }).failures).toEqual([
      "faithfulness 3",
    ]);
    expect(
      decide({ checks: okChecks, judge: grade(5, [true, false]), judged: true }).failures,
    ).toEqual(["1 constraint(s) failed"]);
  });

  it("fails a run that threw, and a judge that gave no grade", () => {
    expect(decide({ error: "boom", judged: true }).failures).toEqual(["run failed: boom"]);
    expect(decide({ checks: okChecks, judgeError: "unreadable", judged: true }).failures).toEqual([
      "judge error: unreadable",
    ]);
  });

  it("ignores the judge when it did not run", () => {
    expect(decide({ checks: okChecks, judged: false }).pass).toBe(true);
  });
});

function result(over: Partial<CaseResult>): CaseResult {
  return {
    id: "a-01",
    tags: [],
    input: "q",
    worldId: "w",
    characterId: 1,
    answer: "a",
    evidence: [],
    characterRecord: null,
    toolsUsed: [],
    toolCalls: [],
    checks: okChecks,
    judge: grade(5),
    pass: true,
    failures: [],
    latencyMs: 1000,
    iterations: 0,
    endedBy: "valid",
    agentCostUsd: 0.02,
    judgeCostUsd: 0.03,
    ...over,
  };
}

describe("summarizeResults", () => {
  const results = [
    result({ id: "a-01" }),
    result({ id: "b-02", judge: grade(3), pass: false, latencyMs: 3000 }),
    result({
      id: "c-03",
      characterId: null,
      checks: {
        ...okChecks,
        inventory: null,
        tools: { pass: false, missing: ["x"], forbiddenCalled: [] },
      },
      judge: grade(4),
      pass: false,
      latencyMs: 2000,
    }),
    result({ id: "d-04", error: "boom", checks: undefined, judge: undefined, pass: false }),
  ];
  const s = summarizeResults(results);

  it("counts the pass rate and names the failures", () => {
    expect(s.passed).toEqual({ ok: 1, of: 4, rate: 0.25 });
    expect(s.failedIds).toEqual(["b-02", "c-03", "d-04"]);
    expect(s.runErrors).toBe(1);
  });

  it("averages the faithfulness over the graded cases only", () => {
    expect(s.faithfulness).toEqual({ mean: 4, graded: 3, atLeast4: 2 });
  });

  it("measures each code check over the cases it applies to", () => {
    expect(s.inventory).toEqual({ ok: 2, of: 2, rate: 1 });
    expect(s.toolCalls).toEqual({ ok: 2, of: 3, rate: 2 / 3 });
    expect(s.citations).toEqual({ ok: 3, of: 3, rate: 1 });
  });

  it("leaves out a run that failed from the latency and adds the costs", () => {
    expect(s.latencyMs).toEqual({ mean: 2000, p50: 2000, p95: 3000 });
    expect(s.agentCostUsd).toBeCloseTo(0.08, 10);
    expect(s.judgeCostUsd).toBeCloseTo(0.12, 10);
  });

  it("has no mean for an empty set", () => {
    const empty = summarizeResults([]);
    expect(empty.faithfulness.mean).toBeUndefined();
    expect(empty.latencyMs).toBeUndefined();
    expect(empty.passed.rate).toBeUndefined();
  });
});
