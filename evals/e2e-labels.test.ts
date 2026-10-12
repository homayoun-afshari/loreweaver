import { describe, expect, it } from "vitest";
import type { JudgeGrade } from "./e2e-judge";
import {
  computeAgreement,
  csvTemplate,
  parseCsv,
  parseLabels,
  pickSample,
  renderReview,
  type Label,
} from "./e2e-labels";
import type { CaseResult } from "./e2e-report";

const grade = (faithfulness: number, pass: boolean): JudgeGrade => ({
  reasoning: "SECRET JUDGE REASONING",
  faithfulness,
  constraints: [{ constraint: "Says it needs flint", pass }],
  judgePass: pass,
  pass,
});

function result(id: string, judge?: JudgeGrade): CaseResult {
  return {
    id,
    tags: [],
    input: `Question of ${id}`,
    worldId: "w",
    characterId: 1,
    answer: `Answer of ${id}`,
    toolsUsed: [],
    toolCalls: [],
    evidence: ["[search_lore] passage 3fa9c1d2 (A): Flint lets it pass."],
    characterRecord: "Aria Voss carries: flint.",
    judge,
    pass: judge?.pass ?? false,
    failures: [],
    latencyMs: 1,
    iterations: 0,
    endedBy: "valid",
    agentCostUsd: 0,
    judgeCostUsd: 0,
  };
}

const label = (caseId: string, pass: boolean, faithfulness: number): Label => ({
  report: "r.json",
  caseId,
  pass,
  faithfulness,
  notes: "",
});

describe("pickSample", () => {
  const results = [
    ...["a", "b", "c", "d", "e", "f"].map((id) => result(`${id}-01`, grade(5, true))),
    ...["g", "h", "i", "j", "k", "l"].map((id) => result(`${id}-02`, grade(3, false))),
  ];

  it("takes half from the judge's fails and half from its passes, sorted by id", () => {
    const sample = pickSample(results, 4);
    expect(sample).toHaveLength(4);
    expect(sample.filter((r) => r.judge!.pass)).toHaveLength(2);
    expect(sample.map((r) => r.id)).toEqual([...sample.map((r) => r.id)].sort());
  });

  it("is the same every time", () => {
    expect(pickSample(results, 5).map((r) => r.id)).toEqual(
      pickSample(results, 5).map((r) => r.id),
    );
  });

  it("fills the sample from the other side when one side is short", () => {
    const few = [result("a-01", grade(3, false)), ...results.slice(0, 6)];
    const sample = pickSample(few, 5);
    expect(sample).toHaveLength(5);
    expect(sample.filter((r) => !r.judge!.pass)).toHaveLength(1);
  });

  it("leaves out a case the judge did not grade, and takes everything when n is large", () => {
    const sample = pickSample([result("a-01"), result("b-01", grade(5, true))], 10);
    expect(sample.map((r) => r.id)).toEqual(["b-01"]);
  });
});

describe("the sheet", () => {
  const sample = [result("a-01", grade(5, true))];

  it("shows the question, evidence, record, answer and constraints but not the judge's grade", () => {
    const text = renderReview(sample, "r.json");
    expect(text).toContain("Question of a-01");
    expect(text).toContain("passage 3fa9c1d2");
    expect(text).toContain("Aria Voss carries: flint.");
    expect(text).toContain("Answer of a-01");
    expect(text).toContain("1. Says it needs flint");
    expect(text).not.toContain("SECRET JUDGE REASONING");
  });

  it("starts the CSV with an empty row per case", () => {
    expect(csvTemplate("r.json", sample)).toBe(
      "report,case_id,human_pass,human_faithfulness,notes\nr.json,a-01,,,\n",
    );
  });
});

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""",d\r\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "d"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("keeps a line break inside quotes and drops blank lines", () => {
    expect(parseCsv('a,"x\ny"\n\n')).toEqual([["a", "x\ny"]]);
  });
});

describe("parseLabels", () => {
  const head = "report,case_id,human_pass,human_faithfulness,notes\n";

  it("reads labels with several spellings of pass and fail", () => {
    const { labels, unlabeled } = parseLabels(
      `${head}r.json,a-01,pass,5,fine\nr.json,b-01,FAIL,2,"invented, a lot"\nr.json,c-01,,,\n`,
    );
    expect(labels).toEqual([
      { report: "r.json", caseId: "a-01", pass: true, faithfulness: 5, notes: "fine" },
      { report: "r.json", caseId: "b-01", pass: false, faithfulness: 2, notes: "invented, a lot" },
    ]);
    expect(unlabeled).toEqual(["c-01"]);
  });

  it("lists every problem at once", () => {
    const run = () =>
      parseLabels(`${head}r.json,a-01,maybe,5,\nr.json,b-01,pass,9,\nr.json,c-01,pass,,\n`);
    expect(run).toThrow(/a-01\): human_pass "maybe"/);
    expect(run).toThrow(/b-01\): human_faithfulness "9"/);
    expect(run).toThrow(/c-01\): human_faithfulness ""/);
  });

  it("rejects a wrong header and a case labeled twice", () => {
    expect(() => parseLabels("case,pass\n")).toThrow(/first line/);
    expect(() => parseLabels(`${head}r.json,a-01,pass,5,\nr.json,a-01,fail,1,\n`)).toThrow(
      /labeled twice/,
    );
  });
});

describe("computeAgreement", () => {
  const results = [
    result("a-01", grade(5, true)),
    result("b-01", grade(5, true)),
    result("c-01", grade(3, false)),
    result("d-01", grade(4, true)),
    result("e-01"),
  ];
  const labels = [
    label("a-01", true, 5),
    label("b-01", false, 3),
    label("c-01", false, 2),
    label("d-01", true, 4),
    label("e-01", true, 5),
    label("zzz-09", true, 5),
  ];
  const a = computeAgreement(results, labels);

  it("counts the labeled cases that have a judge grade, and names the others", () => {
    expect(a.n).toBe(4);
    expect(a.missing).toEqual(["e-01", "zzz-09"]);
  });

  it("measures agreement on the verdict and on the score", () => {
    expect(a.passAgreement).toBe(3);
    expect(a.faithfulnessExact).toBe(2);
    expect(a.faithfulnessWithinOne).toBe(3);
  });

  it("shows which way the judge errs", () => {
    expect(a.judgePassHumanFail).toBe(1);
    expect(a.judgeFailHumanPass).toBe(0);
    // (5-5 + 5-3 + 3-2 + 4-4) / 4
    expect(a.meanFaithfulnessGap).toBeCloseTo(0.75, 10);
  });

  it("lists the cases where they differ", () => {
    expect(a.disagreements.map((d) => d.caseId)).toEqual(["b-01", "c-01"]);
    expect(a.disagreements[0]).toMatchObject({ judgePass: true, humanPass: false });
  });
});
