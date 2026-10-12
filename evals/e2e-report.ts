import { mean, percentile } from "../apps/web/src/lib/stats";
import type { CitationCheck, InventoryCheck, ToolCheck } from "./e2e-checks";
import type { JudgeGrade } from "./e2e-judge";

/**
 * The result of one case of the end-to-end eval, and the numbers over all cases. Pure functions, so
 * the arithmetic is tested without a model.
 */

export type CaseChecks = {
  tools: ToolCheck;
  /** Null when the question names no character, so there is no inventory to compare with. */
  inventory: InventoryCheck | null;
  citations: CitationCheck;
};

export type CaseResult = {
  id: string;
  tags: string[];
  input: string;
  worldId: string;
  characterId: number | null;
  /** The answer the author would get, or "" when the run failed. */
  answer: string;
  /** Set when the agent run threw. */
  error?: string;
  toolsUsed: string[];
  checks?: CaseChecks;
  judge?: JudgeGrade;
  /** Set when the judge could not give a usable grade. */
  judgeError?: string;
  pass: boolean;
  /** Short reasons the case failed, empty for a pass. */
  failures: string[];
  latencyMs: number;
  iterations: number;
  endedBy: string;
  agentCostUsd: number;
  judgeCostUsd: number;
};

/**
 * Whether a case passes, and why not. A case passes when every deterministic check holds and, if
 * the judge ran, the judge passes it. A run that failed, or a judge that gave no grade, is a fail.
 */
export function decide(args: {
  error?: string;
  checks?: CaseChecks;
  judge?: JudgeGrade;
  judgeError?: string;
  judged: boolean;
}): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (args.error) failures.push(`run failed: ${args.error}`);
  const { checks } = args;
  if (checks) {
    if (checks.tools.missing.length > 0) failures.push(`tool not called: ${checks.tools.missing}`);
    if (checks.tools.forbiddenCalled.length > 0) {
      failures.push(`forbidden tool called: ${checks.tools.forbiddenCalled}`);
    }
    if (checks.inventory && !checks.inventory.pass) {
      failures.push(`item not carried: ${checks.inventory.notOwned}`);
    }
    if (!checks.citations.pass)
      failures.push(`unresolved citation: ${checks.citations.unresolved}`);
  }
  if (args.judged && !args.error) {
    if (args.judgeError) failures.push(`judge error: ${args.judgeError}`);
    else if (args.judge) {
      if (args.judge.faithfulness < 4) failures.push(`faithfulness ${args.judge.faithfulness}`);
      const failed = args.judge.constraints.filter((c) => !c.pass).length;
      if (failed > 0) failures.push(`${failed} constraint(s) failed`);
    }
  }
  return { pass: failures.length === 0, failures };
}

const share = (ok: number, of: number) => ({ ok, of, rate: of === 0 ? undefined : ok / of });

export type E2eSummary = ReturnType<typeof summarizeResults>;

export function summarizeResults(results: CaseResult[]) {
  const withChecks = results.filter((r) => r.checks);
  const inventoryCases = withChecks.filter((r) => r.checks?.inventory);
  const judged = results.filter((r) => r.judge);
  const constraints = judged.flatMap((r) => r.judge?.constraints ?? []);
  const latencies = results.filter((r) => !r.error).map((r) => r.latencyMs);
  return {
    cases: results.length,
    passed: share(results.filter((r) => r.pass).length, results.length),
    failedIds: results.filter((r) => !r.pass).map((r) => r.id),
    runErrors: results.filter((r) => r.error).length,
    judgeErrors: results.filter((r) => r.judgeError).length,
    /** The faithfulness is the judge's, averaged over the cases it graded. */
    faithfulness: {
      mean: judged.length === 0 ? undefined : mean(judged.map((r) => r.judge!.faithfulness)),
      graded: judged.length,
      atLeast4: judged.filter((r) => r.judge!.faithfulness >= 4).length,
    },
    constraints: share(constraints.filter((c) => c.pass).length, constraints.length),
    inventory: share(
      inventoryCases.filter((r) => r.checks!.inventory!.pass).length,
      inventoryCases.length,
    ),
    toolCalls: share(withChecks.filter((r) => r.checks!.tools.pass).length, withChecks.length),
    citations: share(withChecks.filter((r) => r.checks!.citations.pass).length, withChecks.length),
    citationsNotRetrieved: withChecks.filter((r) => r.checks!.citations.notRetrieved.length > 0)
      .length,
    latencyMs:
      latencies.length === 0
        ? undefined
        : { mean: mean(latencies), p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    agentCostUsd: results.reduce((t, r) => t + r.agentCostUsd, 0),
    judgeCostUsd: results.reduce((t, r) => t + r.judgeCostUsd, 0),
  };
}
