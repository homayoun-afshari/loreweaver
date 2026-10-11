/**
 * Cost report: pulls the traces of the agent from LangSmith and works out, for every query, the
 * tokens by type, the cost and the end-to-end latency, then the average, the p50 and the p95, and a
 * monthly projection. Nothing is sent to a model: it only reads traces, so it costs nothing.
 *
 *   pnpm cost:report                                  the last 24 hours of the project in .env.local
 *   pnpm cost:report --since 3                        the last 3 hours
 *   pnpm cost:report --from 2026-10-11T17:58:00Z --to 2026-10-11T18:01:00Z   an exact period (UTC)
 *   pnpm cost:report --env development --model claude-sonnet-5-5 --prompt-version agent.v3
 *   pnpm cost:report --project loreweaver-prod        another project (same workspace, same key)
 *   pnpm cost:report --queries-per-day 20 --authors 100,1000,10000
 *   pnpm cost:report --verbose                        one line per query
 *   pnpm cost:report --json                           the whole result as JSON
 *
 * Which traces are counted is decided by the labels of the root run (`env`, `model`,
 * `prompt_version`), so a report can compare two setups. The cost is computed here, with the
 * prices in apps/web/src/lib/ai/models.ts, and checked against the cost LangSmith computes.
 * It needs LANGSMITH_API_KEY, LANGSMITH_ENDPOINT and LANGSMITH_WORKSPACE_ID in apps/web/.env.local.
 */
import { parseArgs } from "node:util";
import { buildQueries, projectMonthly, summarize } from "../apps/web/src/lib/cost-metrics";
import { fetchTraceRuns } from "../apps/web/src/lib/langsmith-runs";

const { values: args } = parseArgs({
  options: {
    project: { type: "string" },
    since: { type: "string", default: "24" },
    from: { type: "string" },
    to: { type: "string" },
    env: { type: "string" },
    model: { type: "string" },
    "prompt-version": { type: "string" },
    "queries-per-day": { type: "string", default: "20" },
    authors: { type: "string", default: "100,1000,10000" },
    verbose: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const usd = (n: number) => `$${n.toFixed(4)}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const tok = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main() {
  let period: string;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // The variables may come from the shell instead.
  }
  const projectName = args.project ?? process.env.LANGSMITH_PROJECT ?? "loreweaver-dev";
  const sinceHours = Number(args.since);
  if (!Number.isFinite(sinceHours) || sinceHours <= 0) throw new Error("--since must be hours");
  // An exact period (--from, --to) wins over the last hours, so a report can be repeated later.
  const from = args.from ? new Date(args.from) : new Date(Date.now() - sinceHours * 3_600_000);
  const to = args.to ? new Date(args.to) : undefined;
  if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) {
    throw new Error("--from and --to must be dates, like 2026-10-11T17:58:00Z");
  }
  period =
    args.from || args.to
      ? `${from.toISOString()} to ${(to ?? new Date()).toISOString()}`
      : `the last ${sinceHours} h`;
  const queriesPerDay = Number(args["queries-per-day"]);
  const authors = args.authors!.split(",").map((n) => Number(n.trim()));
  if (!Number.isFinite(queriesPerDay) || authors.some((n) => !Number.isFinite(n))) {
    throw new Error("--queries-per-day and --authors must be numbers");
  }

  const fetched = await fetchTraceRuns({
    projectName,
    since: from,
    until: to,
  });
  const roots = fetched.roots.filter(
    (r) =>
      (!args.env || r.env === args.env) &&
      (!args.model || r.model === args.model) &&
      (!args["prompt-version"] || r.promptVersion === args["prompt-version"]),
  );
  const wanted = new Set(roots.map((r) => r.traceId));
  const calls = fetched.calls.filter((c) => wanted.has(c.traceId));

  const { queries, skipped } = buildQueries(roots, calls);
  if (queries.length === 0) {
    throw new Error(
      `No query to report in "${projectName}" for ${period} with these filters ` +
        `(root traces found: ${roots.length}, skipped: ${JSON.stringify(skipped)}).`,
    );
  }
  const s = summarize(queries);
  const projection = authors.map((n) => ({
    authors: n,
    mean: projectMonthly(s.costUsd.mean, queriesPerDay, n),
    p95: projectMonthly(s.costUsd.p95, queriesPerDay, n),
  }));

  if (args.json) {
    const filters = { env: args.env, model: args.model, promptVersion: args["prompt-version"] };
    console.log(
      JSON.stringify(
        { projectName, period, filters, queries, skipped, summary: s, projection },
        null,
        2,
      ),
    );
    return;
  }

  const filters = [
    args.env && `env ${args.env}`,
    args.model && `model ${args.model}`,
    args["prompt-version"] && `prompt ${args["prompt-version"]}`,
  ].filter(Boolean);
  console.log(
    `Project ${projectName}, ${period}${filters.length ? `, ${filters.join(", ")}` : ""}: ` +
      `${queries.length} queries (left out: ${skipped.notSuccessful} failed, ${skipped.noCalls} without a model call, ${skipped.unknownModel} with an unpriced model).\n`,
  );

  if (args.verbose) {
    console.log(
      "| Started | Model | Latency | Calls | Input | Cache read | Cache write | Output | Cost |",
    );
    console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const q of [...queries].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      console.log(
        `| ${q.startedAt.slice(11, 19)} | ${q.model} | ${sec(q.latencyMs)} | ${q.calls} | ${tok(q.tokens.input)} | ${tok(q.tokens.cacheRead)} | ${tok(q.tokens.cacheWrite)} | ${tok(q.tokens.output)} | ${usd(q.costUsd)} |`,
      );
    }
    console.log();
  }

  console.log("| Per query | mean | p50 | p95 |");
  console.log("| --- | ---: | ---: | ---: |");
  console.log(`| Cost | ${usd(s.costUsd.mean)} | ${usd(s.costUsd.p50)} | ${usd(s.costUsd.p95)} |`);
  console.log(
    `| End-to-end latency | ${sec(s.latencyMs.mean)} | ${sec(s.latencyMs.p50)} | ${sec(s.latencyMs.p95)} |`,
  );

  console.log("\n| Tokens per query (mean) | |");
  console.log("| --- | ---: |");
  console.log(`| Input (not cached) | ${tok(s.tokens.input)} |`);
  console.log(`| Input read from the cache | ${tok(s.tokens.cacheRead)} |`);
  console.log(`| Input written to the cache | ${tok(s.tokens.cacheWrite)} |`);
  console.log(`| Output | ${tok(s.tokens.output)} |`);
  console.log(`| Model calls | ${s.modelCalls.toFixed(1)} |`);
  console.log(`| Cache hit rate (share of input read from the cache) | ${pct(s.cacheHitRate)} |`);

  console.log("\n| Where the money goes | Share of cost |");
  console.log("| --- | ---: |");
  for (const [type, share] of Object.entries(s.costShareByType)) {
    console.log(`| ${type} tokens | ${pct(share)} |`);
  }
  for (const [node, share] of Object.entries(s.costShareByNode)) {
    console.log(`| node ${node} | ${pct(share)} |`);
  }

  console.log(`\nMonthly cost at ${queriesPerDay} queries per author per day, 30 days:\n`);
  console.log("| Active authors | At the mean cost | At the p95 cost |");
  console.log("| ---: | ---: | ---: |");
  for (const p of projection) {
    console.log(`| ${p.authors.toLocaleString("en-US")} | ${money(p.mean)} | ${money(p.p95)} |`);
  }

  const gap = s.totalCostUsd - s.langsmithCostUsd;
  console.log(
    `\nCheck: ${usd(s.totalCostUsd)} here against ${usd(s.langsmithCostUsd)} computed by LangSmith (difference ${usd(gap)}). ` +
      `The embedding cost of the lore search is not in the traces: it is far below $0.000001 a query and inside the free allowance.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
