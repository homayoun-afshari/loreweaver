import type { BaseMessage } from "@langchain/core/messages";
import { costUsd, type ModelId } from "@/lib/ai/models";
import { RULE_CHECK_UNAVAILABLE, RULE_EMPTY_ANSWER } from "@/lib/agent/reflection";
import type { Usage, Verdict } from "@/lib/agent/state";
import { mean, percentile } from "./stats";

/**
 * Turns the node updates of agent runs into the numbers of the agent measurement
 * (scripts/measure-agent.ts). Pure functions, so the arithmetic is tested without a model.
 */

/** One node update of a run, with the time it arrived, in milliseconds from the start of the run. */
export type RunEvent = {
  node: string;
  atMs: number;
  update: {
    messages?: BaseMessage[];
    draftAnswer?: string;
    reflection?: Verdict | null;
    iterations?: number;
    usage?: Usage;
  };
};

/**
 * What a verdict says about a draft. An empty draft and an unavailable check say nothing about
 * the rules of the world, so they are not counted as rule violations.
 */
export type VerdictKind = "clean" | "violations" | "empty" | "unavailable";

export function kindOf(verdict: Verdict | undefined): VerdictKind | undefined {
  if (!verdict) return undefined;
  if (verdict.valid) return "clean";
  if (verdict.violations.some((v) => v.rule_id === RULE_CHECK_UNAVAILABLE)) return "unavailable";
  if (verdict.violations.every((v) => v.rule_id === RULE_EMPTY_ANSWER)) return "empty";
  return "violations";
}

/** How a run ended. */
export type EndedBy = "valid" | "revision-limit" | "time-limit" | "check-unavailable" | "no-check";

export type RunRecord = {
  promptId: string;
  temptsRuleBreak: boolean;
  totalMs: number;
  /** Time spent per kind of work: the first draft, the checks, and the revisions. */
  draftMs: number;
  checkMs: number;
  revisionMs: number;
  drafts: number;
  checks: number;
  iterations: number;
  firstVerdict: VerdictKind | undefined;
  finalVerdict: VerdictKind | undefined;
  firstViolations: string[];
  finalViolations: string[];
  endedBy: EndedBy;
  toolsUsed: string[];
  expectedToolsCalled: boolean;
  tokens: {
    draft: { input: number; output: number };
    revision: { input: number; output: number };
    check: { input: number; output: number };
  };
  /** Cost of the whole run, in USD, by the list prices of the two models. */
  costUsd: number;
  /** What the checking and the revisions added to the run: time and money. */
  overheadMs: number;
  overheadCostUsd: number;
  answerWords: number;
  caveat: boolean;
};

const CAVEAT = "\n\nNote: this answer";

function toolCallsOf(messages: BaseMessage[] | undefined): string[] {
  return (messages ?? []).flatMap((m) =>
    m.type === "ai"
      ? ((m as { tool_calls?: { name: string }[] }).tool_calls ?? []).map((c) => c.name)
      : [],
  );
}

/**
 * Summarizes one run. Work before the first check is "draft" (the agent and the tools), every
 * check is "check", and the agent and tools work after the first check is "revision". Checking
 * and revising together are what reflection adds to a run.
 */
export function summarizeRun(args: {
  promptId: string;
  temptsRuleBreak: boolean;
  expectedTools: string[];
  events: RunEvent[];
  totalMs: number;
  maxIterations: number;
  agentModel: ModelId;
  reflectionModel: ModelId;
}): RunRecord {
  const tokens = {
    draft: { input: 0, output: 0 },
    revision: { input: 0, output: 0 },
    check: { input: 0, output: 0 },
  };
  let draftMs = 0;
  let checkMs = 0;
  let revisionMs = 0;
  let drafts = 0;
  let checks = 0;
  let iterations = 0;
  let answer = "";
  let sawCheck = false;
  const verdicts: Verdict[] = [];
  const tools = new Set<string>();
  let previousAt = 0;

  for (const { node, atMs, update } of args.events) {
    const took = Math.max(0, atMs - previousAt);
    previousAt = atMs;
    const usage = update.usage;
    if (typeof update.draftAnswer === "string") answer = update.draftAnswer;
    if (typeof update.iterations === "number") iterations = update.iterations;

    if (node === "reflect") {
      sawCheck = true;
      checks++;
      checkMs += took;
      if (update.reflection) verdicts.push(update.reflection);
      if (usage) {
        tokens.check.input += usage.reflection.input;
        tokens.check.output += usage.reflection.output;
      }
      continue;
    }

    const stage = sawCheck ? "revision" : "draft";
    if (stage === "draft") draftMs += took;
    else revisionMs += took;
    if (usage) {
      tokens[stage].input += usage.agent.input;
      tokens[stage].output += usage.agent.output;
    }
    if (node === "agent") {
      const calls = toolCallsOf(update.messages);
      calls.forEach((name) => tools.add(name));
      if (calls.length === 0) drafts++;
    }
  }

  const first = verdicts[0];
  const last = verdicts.at(-1);
  const finalKind = kindOf(last);
  let endedBy: EndedBy = "no-check";
  if (finalKind === "clean") endedBy = "valid";
  else if (finalKind === "unavailable") endedBy = "check-unavailable";
  else if (finalKind === "violations" || finalKind === "empty") {
    endedBy = iterations >= args.maxIterations ? "revision-limit" : "time-limit";
  }

  const agentTokens = {
    input: tokens.draft.input + tokens.revision.input,
    output: tokens.draft.output + tokens.revision.output,
  };
  const cost =
    costUsd(args.agentModel, agentTokens.input, agentTokens.output) +
    costUsd(args.reflectionModel, tokens.check.input, tokens.check.output);
  const overheadCost =
    costUsd(args.agentModel, tokens.revision.input, tokens.revision.output) +
    costUsd(args.reflectionModel, tokens.check.input, tokens.check.output);

  return {
    promptId: args.promptId,
    temptsRuleBreak: args.temptsRuleBreak,
    totalMs: args.totalMs,
    draftMs,
    checkMs,
    revisionMs,
    drafts,
    checks,
    iterations,
    firstVerdict: kindOf(first),
    finalVerdict: finalKind,
    firstViolations: first?.violations.map((v) => `${v.rule_id}: ${v.explanation}`) ?? [],
    finalViolations: last?.violations.map((v) => `${v.rule_id}: ${v.explanation}`) ?? [],
    endedBy,
    toolsUsed: [...tools],
    expectedToolsCalled: args.expectedTools.every((t) => tools.has(t)),
    tokens,
    costUsd: cost,
    overheadMs: checkMs + revisionMs,
    overheadCostUsd: overheadCost,
    answerWords: answer.trim() === "" ? 0 : answer.trim().split(/\s+/).length,
    caveat: answer.includes(CAVEAT),
  };
}

const share = (count: number, of: number): number | undefined =>
  of === 0 ? undefined : count / of;

/** The rate of drafts with violations among the runs whose check gave a usable verdict. */
function violationRate(records: RunRecord[], pick: (r: RunRecord) => VerdictKind | undefined) {
  const usable = records.filter((r) => {
    const kind = pick(r);
    return kind === "clean" || kind === "violations";
  });
  const bad = usable.filter((r) => pick(r) === "violations").length;
  return { bad, of: usable.length, rate: share(bad, usable.length) };
}

export type Summary = ReturnType<typeof summarizeRuns>;

export function summarizeRuns(records: RunRecord[]) {
  const first = (r: RunRecord) => r.firstVerdict;
  const final = (r: RunRecord) => r.finalVerdict;
  const tempting = records.filter((r) => r.temptsRuleBreak);
  const plain = records.filter((r) => !r.temptsRuleBreak);
  const stats = (values: number[]) => ({
    mean: mean(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  });
  const count = (by: EndedBy) => records.filter((r) => r.endedBy === by).length;
  const overheadShareOfLatency = records.map((r) => r.overheadMs / r.totalMs);
  const overheadShareOfCost = records.map((r) => r.overheadCostUsd / r.costUsd);

  return {
    runs: records.length,
    violations: {
      firstDrafts: violationRate(records, first),
      finalAnswers: violationRate(records, final),
      firstDraftsTempting: violationRate(tempting, first),
      finalAnswersTempting: violationRate(tempting, final),
      firstDraftsPlain: violationRate(plain, first),
      finalAnswersPlain: violationRate(plain, final),
    },
    iterations: {
      mean: mean(records.map((r) => r.iterations)),
      withRevision: records.filter((r) => r.iterations > 0).length,
    },
    ended: {
      valid: count("valid"),
      revisionLimit: count("revision-limit"),
      timeLimit: count("time-limit"),
      checkUnavailable: count("check-unavailable"),
      noCheck: count("no-check"),
    },
    emptyFirstDrafts: records.filter((r) => r.firstVerdict === "empty").length,
    emptyFinalAnswers: records.filter((r) => r.finalVerdict === "empty").length,
    caveats: records.filter((r) => r.caveat).length,
    latencyMs: stats(records.map((r) => r.totalMs)),
    overheadMs: stats(records.map((r) => r.overheadMs)),
    checkMs: stats(records.map((r) => r.checkMs)),
    revisionMs: stats(records.map((r) => r.revisionMs)),
    overheadShareOfLatency: mean(overheadShareOfLatency),
    costUsd: stats(records.map((r) => r.costUsd)),
    overheadCostUsd: stats(records.map((r) => r.overheadCostUsd)),
    overheadShareOfCost: mean(overheadShareOfCost),
    checkTokens: {
      input: mean(records.map((r) => r.tokens.check.input)),
      output: mean(records.map((r) => r.tokens.check.output)),
    },
    revisionTokens: {
      input: mean(records.map((r) => r.tokens.revision.input)),
      output: mean(records.map((r) => r.tokens.revision.output)),
    },
    answerWords: stats(records.map((r) => r.answerWords)),
    expectedToolsCalled: records.filter((r) => r.expectedToolsCalled).length,
  };
}
