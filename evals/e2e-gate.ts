import type { E2eSummary } from "./e2e-report";

/**
 * The gate: whether a run of the eval is good enough to let a pull request through. It is the same
 * numbers the runner prints, judged against two rules a workflow can set:
 *
 *  - `minFaithfulness`: the mean faithfulness of the judge must reach it (the smoke set);
 *  - `requireAll`: every case must pass (the red-team set).
 *
 * A run that could not be graded (a case that threw, a judge that gave no grade) fails the gate: a
 * gate that cannot see must not wave a change through.
 */

export type GateOptions = { minFaithfulness?: number; requireAll?: boolean };

export type GateResult = {
  /** False when no rule was set: the runner then only reports and always exits with success. */
  active: boolean;
  pass: boolean;
  reasons: string[];
};

export function evaluateGate(
  summary: Pick<E2eSummary, "cases" | "failedIds" | "runErrors" | "judgeErrors" | "faithfulness">,
  options: GateOptions,
): GateResult {
  const active = options.minFaithfulness !== undefined || options.requireAll === true;
  if (!active) return { active, pass: true, reasons: [] };

  const reasons: string[] = [];
  if (summary.cases === 0) reasons.push("no case was run");
  if (summary.runErrors > 0) reasons.push(`${summary.runErrors} run(s) failed`);
  if (summary.judgeErrors > 0) reasons.push(`${summary.judgeErrors} judge error(s)`);

  if (options.minFaithfulness !== undefined) {
    const mean = summary.faithfulness.mean;
    if (mean === undefined) reasons.push("no case was graded, so the faithfulness is unknown");
    else if (mean < options.minFaithfulness) {
      reasons.push(
        `mean faithfulness ${mean.toFixed(2)} is below the threshold ${options.minFaithfulness}`,
      );
    }
  }
  if (options.requireAll && summary.failedIds.length > 0) {
    reasons.push(`case(s) failed: ${summary.failedIds.join(", ")}`);
  }
  return { active, pass: reasons.length === 0, reasons };
}

/** A threshold or score given on the command line: a number, or an error that names the flag. */
export function parseThreshold(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) {
    throw new Error(`${flag} must be a number from 1 to 5 (got "${value}")`);
  }
  return n;
}
