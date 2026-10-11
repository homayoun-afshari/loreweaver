import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { noUsage, type Usage, type Verdict } from "@/lib/agent/state";
import { costUsd } from "@/lib/ai/models";
import { summarizeRun, summarizeRuns, type RunEvent, type RunRecord } from "./agent-metrics";

const usage = (agent: [number, number], check: [number, number] = [0, 0]): Usage => ({
  ...noUsage(),
  agent: { input: agent[0], output: agent[1] },
  reflection: { input: check[0], output: check[1] },
});
const valid: Verdict = { valid: true, violations: [] };
const broken: Verdict = {
  valid: false,
  violations: [{ rule_id: "inventory", explanation: "No rope." }],
};
const unavailable: Verdict = {
  valid: false,
  violations: [{ rule_id: "check_unavailable", explanation: "The check did not run." }],
};
const asksFor = (name: string) =>
  new AIMessage({ content: "", tool_calls: [{ id: "c", name, args: {}, type: "tool_call" }] });
const draftEvent = (at: number, text = "D", used?: Usage): RunEvent => ({
  node: "agent",
  atMs: at,
  update: { messages: [new AIMessage(text)], draftAnswer: text, usage: used },
});
const checkEvent = (
  at: number,
  verdict: Verdict,
  extra: { iterations?: number; draftAnswer?: string; usage?: Usage } = {},
): RunEvent => ({ node: "reflect", atMs: at, update: { reflection: verdict, ...extra } });

function run(
  events: RunEvent[],
  over: { tempts?: boolean; maxIterations?: number } = {},
): RunRecord {
  return summarizeRun({
    promptId: "p-01",
    temptsRuleBreak: over.tempts ?? true,
    expectedTools: ["fetch_character_state", "search_lore"],
    events,
    totalMs: events.at(-1)?.atMs ?? 0,
    maxIterations: over.maxIterations ?? 2,
    agentModel: "claude-sonnet-5-5",
    reflectionModel: "claude-haiku-4-5",
  });
}

describe("summarizeRun", () => {
  it("splits time and tokens into the first draft, the checks and the revisions", () => {
    const record = run([
      {
        node: "agent",
        atMs: 1000,
        update: { messages: [asksFor("fetch_character_state")], usage: usage([1000, 50]) },
      },
      { node: "tools", atMs: 1500, update: {} },
      {
        node: "agent",
        atMs: 4000,
        update: { messages: [asksFor("search_lore")], usage: usage([1200, 40]) },
      },
      { node: "tools", atMs: 4300, update: {} },
      draftEvent(7000, "Draft 1", usage([1500, 300])),
      checkEvent(8000, broken, { iterations: 1, usage: usage([0, 0], [600, 40]) }),
      draftEvent(11000, "Draft 2", usage([1700, 250])),
      checkEvent(12000, valid, { usage: usage([0, 0], [650, 10]) }),
    ]);

    expect(record.draftMs).toBe(7000);
    expect(record.checkMs).toBe(2000);
    expect(record.revisionMs).toBe(3000);
    expect(record.overheadMs).toBe(5000);
    expect(record.tokens.draft).toEqual({ input: 3700, output: 390 });
    expect(record.tokens.revision).toEqual({ input: 1700, output: 250 });
    expect(record.tokens.check).toEqual({ input: 1250, output: 50 });
    expect(record.drafts).toBe(2);
    expect(record.checks).toBe(2);
    expect(record.iterations).toBe(1);
    expect(record.firstVerdict).toBe("violations");
    expect(record.finalVerdict).toBe("clean");
    expect(record.endedBy).toBe("valid");
    expect(record.expectedToolsCalled).toBe(true);
    expect(record.answerWords).toBe(2);
    expect(record.caveat).toBe(false);
  });

  it("prices the run with each model's own prices, and counts the check as overhead", () => {
    const record = run([
      draftEvent(1000, "Draft", usage([1_000_000, 100_000])),
      checkEvent(2000, valid, { usage: usage([0, 0], [1_000_000, 100_000]) }),
    ]);
    const sonnet = costUsd("claude-sonnet-5-5", 1_000_000, 100_000);
    const haiku = costUsd("claude-haiku-4-5", 1_000_000, 100_000);
    expect(record.costUsd).toBeCloseTo(sonnet + haiku, 10);
    // With no revision, the overhead is the check alone.
    expect(record.overheadCostUsd).toBeCloseTo(haiku, 10);
  });

  it("tells how a run ended", () => {
    const caveated = "D\n\nNote: this answer may still conflict with the world's rules.";

    expect(run([draftEvent(1), checkEvent(2, valid)]).endedBy).toBe("valid");

    const atLimit = run(
      [
        draftEvent(1),
        checkEvent(2, broken, { iterations: 1 }),
        draftEvent(3),
        checkEvent(4, broken, { draftAnswer: caveated }),
      ],
      { maxIterations: 1 },
    );
    expect(atLimit.endedBy).toBe("revision-limit");

    // Invalid with revisions left: only the time limit can have stopped it.
    const late = run([draftEvent(1), checkEvent(2, broken, { draftAnswer: caveated })]);
    expect(late.endedBy).toBe("time-limit");
    expect(late.caveat).toBe(true);

    expect(
      run([draftEvent(1), checkEvent(2, unavailable, { draftAnswer: caveated })]).endedBy,
    ).toBe("check-unavailable");
    expect(run([draftEvent(1)]).endedBy).toBe("no-check");
  });

  it("notes whether the expected tools were called", () => {
    const record = run([
      { node: "agent", atMs: 1, update: { messages: [asksFor("search_lore")] } },
      draftEvent(2),
      checkEvent(3, valid),
    ]);
    expect(record.toolsUsed).toEqual(["search_lore"]);
    expect(record.expectedToolsCalled).toBe(false);
  });
});

describe("summarizeRuns", () => {
  type Kind = "clean" | "violations" | "unavailable";
  const record = (
    first: Kind,
    final: Kind,
    tempts: boolean,
    over: Partial<RunRecord> = {},
  ): RunRecord => ({
    ...run(
      [
        draftEvent(1000, "D", usage([1000, 100])),
        checkEvent(2000, valid, { usage: usage([0, 0], [500, 20]) }),
      ],
      { tempts },
    ),
    firstVerdict: first,
    finalVerdict: final,
    ...over,
  });

  it("rates violations in first drafts and in final answers, overall and by kind of prompt", () => {
    const summary = summarizeRuns([
      record("violations", "clean", true, { iterations: 1, endedBy: "valid" }),
      record("violations", "violations", true, { iterations: 2, endedBy: "revision-limit" }),
      record("clean", "clean", true),
      record("violations", "clean", false, { iterations: 1, endedBy: "valid" }),
      // An unavailable check says nothing about the rules, so it is left out of both rates.
      record("unavailable", "unavailable", false, { endedBy: "check-unavailable" }),
    ]);
    expect(summary.runs).toBe(5);
    expect(summary.violations.firstDrafts).toEqual({ bad: 3, of: 4, rate: 0.75 });
    expect(summary.violations.finalAnswers).toEqual({ bad: 1, of: 4, rate: 0.25 });
    expect(summary.violations.firstDraftsTempting).toEqual({ bad: 2, of: 3, rate: 2 / 3 });
    expect(summary.violations.firstDraftsPlain).toEqual({ bad: 1, of: 1, rate: 1 });
    expect(summary.violations.finalAnswersPlain).toEqual({ bad: 0, of: 1, rate: 0 });
    expect(summary.iterations.mean).toBeCloseTo(0.8, 10);
    expect(summary.iterations.withRevision).toBe(3);
    expect(summary.ended.revisionLimit).toBe(1);
    expect(summary.ended.checkUnavailable).toBe(1);
  });

  it("gives no rate when no run had a usable verdict", () => {
    const summary = summarizeRuns([record("unavailable", "unavailable", true)]);
    expect(summary.violations.firstDrafts).toEqual({ bad: 0, of: 0, rate: undefined });
  });
});
