import { describe, expect, it } from "vitest";
import {
  changedCases,
  columnName,
  METRIC_ROWS,
  renderTable,
  type StoredReport,
} from "./e2e-compare";

const report = (over: Partial<StoredReport> = {}): StoredReport => ({
  meta: { label: "run", agentPromptVersion: "agent.v5", agentModel: "claude-sonnet-5-5" },
  summary: {
    cases: 4,
    passed: { ok: 3, of: 4, rate: 0.75 },
    faithfulness: { mean: 4.5, graded: 4, atLeast4: 3 },
    constraints: { ok: 7, of: 8, rate: 0.875 },
    toolCalls: { ok: 4, of: 4, rate: 1 },
    latencyMs: { mean: 9000, p50: 8800.4, p95: 15040 },
    agentCostUsd: 0.2,
    judgeCostUsd: 0.3,
    runErrors: 0,
    judgeErrors: 1,
  },
  results: [
    { id: "a-01", pass: true },
    { id: "b-02", pass: false },
  ],
  ...over,
});

const read = (label: string, r: StoredReport) =>
  METRIC_ROWS.find((row) => row.label === label)!.read(r.summary);

describe("the metrics", () => {
  const r = report();

  it("format a share as a rounded percent and the counts", () => {
    expect(read("Pass rate", r)).toBe("75% (3/4)");
    expect(read("Constraints passed (judge)", r)).toBe("88% (7/8)");
    expect(read("Tool-call accuracy", r)).toBe("100% (4/4)");
  });

  it("format the faithfulness, the latency, the cost and the errors", () => {
    expect(read("Mean faithfulness (judge)", r)).toBe("4.50 over 4");
    expect(read("Cases with faithfulness 4 or 5", r)).toBe("3/4");
    expect(read("Latency p50 / p95", r)).toBe("8.8 s / 15.0 s");
    expect(read("Cost: agent / judge / total", r)).toBe("$0.2000 / $0.3000 / $0.5000");
    expect(read("Runs failed / judge errors", r)).toBe("0 / 1");
  });

  it("say n/a for what a report does not have, or has no case for", () => {
    expect(read("Safe answers", r)).toBe("n/a");
    expect(read("Inventory accuracy", r)).toBe("n/a");
    const empty = report({ summary: { passed: { ok: 0, of: 0 } } });
    expect(read("Pass rate", empty)).toBe("n/a");
    expect(read("Mean faithfulness (judge)", empty)).toBe("n/a");
    expect(read("Latency p50 / p95", empty)).toBe("n/a");
  });
});

describe("columnName", () => {
  it("names the run, the prompt and the model, and says when the defenses were off", () => {
    expect(columnName("before", report())).toBe("before · agent.v5 · sonnet-5-5");
    const off = report({ meta: { label: "x", agentModel: "claude-haiku-4-5", guardrails: false } });
    expect(columnName(undefined, off)).toBe("x · haiku-4-5 · no guardrails");
  });
});

describe("renderTable", () => {
  it("has one column per report and leaves out a row that no report has", () => {
    const table = renderTable([
      { name: "a", report: report() },
      { name: "b", report: report() },
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Metric | a · agent.v5 · sonnet-5-5 | b · agent.v5 · sonnet-5-5 |");
    expect(lines[1]).toBe("| --- | ---: | ---: |");
    expect(table).toContain("| Pass rate | 75% (3/4) | 75% (3/4) |");
    expect(table).not.toContain("Safe answers");
    expect(table).not.toContain("Over-refusal");
  });

  it("shows a row when only one report has it", () => {
    const withSafety = report({ summary: { safety: { ok: 8, of: 8, rate: 1 } } });
    const table = renderTable([{ report: report() }, { report: withSafety }]);
    expect(table).toContain("| Safe answers | n/a | 100% (8/8) |");
  });
});

describe("changedCases", () => {
  const was = report({
    results: [
      { id: "a-01", pass: false },
      { id: "b-02", pass: true },
      { id: "c-03", pass: true },
      { id: "only-before-04", pass: true },
    ],
  });
  const now = report({
    results: [
      { id: "a-01", pass: true },
      { id: "b-02", pass: false },
      { id: "c-03", pass: true },
      { id: "only-after-05", pass: false },
    ],
  });

  it("lists the cases fixed and the cases that regressed", () => {
    const c = changedCases(was, now);
    expect(c.fixed).toEqual(["a-01"]);
    expect(c.regressed).toEqual(["b-02"]);
  });

  it("lists the cases that only one report has, without counting them as changes", () => {
    const c = changedCases(was, now);
    expect(c.onlyBefore).toEqual(["only-before-04"]);
    expect(c.onlyAfter).toEqual(["only-after-05"]);
  });
});
