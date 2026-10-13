/**
 * Reads the summaries of eval reports and lays them side by side. A report stores the summary that
 * was computed when it was written, so these functions only format it: they never recompute a number
 * from the answers, and a report written before a metric existed shows "n/a" for it. Pure functions,
 * tested without a report on disk.
 */

type Share = { ok: number; of: number; rate?: number };

export type StoredSummary = {
  cases?: number;
  passed?: Share;
  failedIds?: string[];
  runErrors?: number;
  judgeErrors?: number;
  faithfulness?: { mean?: number; graded: number; atLeast4: number };
  constraints?: Share;
  inventory?: Share;
  toolCalls?: Share;
  citations?: Share;
  safety?: Share;
  guardFired?: number;
  inputLimit?: Share;
  overRefusal?: Share;
  latencyMs?: { mean: number; p50: number; p95: number };
  agentCostUsd?: number;
  judgeCostUsd?: number;
};

export type StoredReport = {
  meta: {
    dataset?: string;
    label?: string | null;
    agentModel?: string;
    agentPromptVersion?: string;
    judgeModel?: string | null;
    guardrails?: boolean;
  };
  summary: StoredSummary;
  results: { id: string; pass: boolean }[];
};

const NA = "n/a";

const share = (s: Share | undefined): string =>
  s === undefined || s.of === 0 ? NA : `${Math.round((s.ok / s.of) * 100)}% (${s.ok}/${s.of})`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (n: number | undefined) => (n === undefined ? NA : `$${n.toFixed(4)}`);

/** The metrics of the table, in order, each with the way to read it from a summary. */
export const METRIC_ROWS: { label: string; read: (s: StoredSummary) => string }[] = [
  { label: "Cases", read: (s) => (s.cases === undefined ? NA : String(s.cases)) },
  { label: "Pass rate", read: (s) => share(s.passed) },
  {
    label: "Mean faithfulness (judge)",
    read: (s) =>
      s.faithfulness?.mean === undefined
        ? NA
        : `${s.faithfulness.mean.toFixed(2)} over ${s.faithfulness.graded}`,
  },
  {
    label: "Cases with faithfulness 4 or 5",
    read: (s) =>
      s.faithfulness === undefined || s.faithfulness.graded === 0
        ? NA
        : `${s.faithfulness.atLeast4}/${s.faithfulness.graded}`,
  },
  { label: "Constraints passed (judge)", read: (s) => share(s.constraints) },
  { label: "Inventory accuracy", read: (s) => share(s.inventory) },
  { label: "Tool-call accuracy", read: (s) => share(s.toolCalls) },
  { label: "Citations that resolve", read: (s) => share(s.citations) },
  { label: "Safe answers", read: (s) => share(s.safety) },
  {
    label: "Answers replaced by the guard",
    read: (s) => (s.guardFired === undefined ? NA : String(s.guardFired)),
  },
  { label: "Over-refusal", read: (s) => share(s.overRefusal) },
  { label: "Rejected by the input limit", read: (s) => share(s.inputLimit) },
  {
    label: "Runs failed / judge errors",
    read: (s) =>
      s.runErrors === undefined || s.judgeErrors === undefined
        ? NA
        : `${s.runErrors} / ${s.judgeErrors}`,
  },
  {
    label: "Latency p50 / p95",
    read: (s) => (s.latencyMs ? `${seconds(s.latencyMs.p50)} / ${seconds(s.latencyMs.p95)}` : NA),
  },
  {
    label: "Cost: agent / judge / total",
    read: (s) =>
      s.agentCostUsd === undefined
        ? NA
        : `${usd(s.agentCostUsd)} / ${usd(s.judgeCostUsd)} / ${usd(s.agentCostUsd + (s.judgeCostUsd ?? 0))}`,
  },
];

/** The heading of a column: the label of the run, the prompt and the agent model. */
export function columnName(name: string | undefined, report: StoredReport): string {
  const { agentPromptVersion, agentModel, guardrails } = report.meta;
  const parts = [name ?? report.meta.label ?? "run"];
  if (agentPromptVersion) parts.push(agentPromptVersion);
  if (agentModel) parts.push(agentModel.replace("claude-", ""));
  if (guardrails === false) parts.push("no guardrails");
  return parts.join(" · ");
}

/** A Markdown table: one column per report, one row per metric that at least one report has. */
export function renderTable(columns: { name?: string; report: StoredReport }[]): string {
  const rows = METRIC_ROWS.filter((row) => columns.some((c) => row.read(c.report.summary) !== NA));
  const header = ["Metric", ...columns.map((c) => columnName(c.name, c.report))];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${["---", ...columns.map(() => "---:")].join(" | ")} |`,
    ...rows.map(
      (row) => `| ${[row.label, ...columns.map((c) => row.read(c.report.summary))].join(" | ")} |`,
    ),
  ];
  return lines.join("\n");
}

/** The cases whose verdict differs between two reports (by id), and the cases only one has. */
export function changedCases(before: StoredReport, after: StoredReport) {
  const was = new Map(before.results.map((r) => [r.id, r.pass]));
  const now = new Map(after.results.map((r) => [r.id, r.pass]));
  const common = [...now.keys()].filter((id) => was.has(id)).sort();
  return {
    fixed: common.filter((id) => !was.get(id) && now.get(id)),
    regressed: common.filter((id) => was.get(id) && !now.get(id)),
    onlyBefore: [...was.keys()].filter((id) => !now.has(id)).sort(),
    onlyAfter: [...now.keys()].filter((id) => !was.has(id)).sort(),
  };
}
