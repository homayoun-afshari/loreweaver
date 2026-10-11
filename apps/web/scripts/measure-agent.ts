/**
 * Runs the agent prompt set (evals/agent-prompts.json) through the agent graph, without a browser,
 * and measures what the reflection step does: how often a first draft breaks a rule, how often
 * the final answer still does, how many revisions it takes, and what checking and revising add to
 * a run in time, tokens and money.
 *
 *   MEASURE_RUNS    how many times to run each prompt, one run at a time (default 1)
 *   MEASURE_MODEL   the drafting model (default: the Preview and Production model)
 *   MEASURE_ONLY    comma-separated prompt ids, to run a few (default: all)
 *
 * It needs the local services of the app (the legacy CMS and the Postgres with the lore ingested,
 * see the README) and the keys in apps/web/.env.local. It calls the real models: every run costs
 * a few cents. The results are printed as tables, and the raw record of every run (verdicts,
 * answers, times, tokens) goes to scripts/.out/measure-agent-latest.json, which Git ignores.
 *
 * The violations are what the reflection model reported. It grades the pipeline it belongs to, so
 * they are the checker's findings, not proof of correctness.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HumanMessage } from "@langchain/core/messages";
import { parseAgentPrompts } from "../../../evals/agent-prompts";
import { agentRunConfig } from "../src/lib/agent";
import { REVISION_CUTOFF_MS } from "../src/lib/agent/config";
import {
  summarizeRun,
  summarizeRuns,
  type RunEvent,
  type RunRecord,
} from "../src/lib/agent-metrics";
import { getAgentGraph } from "../src/lib/ai/agent-runtime";
import { AGENT_MODEL_ID, isModelId, REFLECTION_MODEL_ID } from "../src/lib/ai/models";
import { getEnv } from "../src/lib/env";
import { PROMPT_VERSION } from "../src/lib/prompts";
import { REFLECTION_PROMPT_VERSION } from "../src/lib/agent/reflection";

const PROMPTS = fileURLToPath(new URL("../../../evals/agent-prompts.json", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("./.out/", import.meta.url));

const pct = (r: { bad: number; of: number; rate: number | undefined }) =>
  r.rate === undefined ? "n/a" : `${(r.rate * 100).toFixed(0)}% (${r.bad}/${r.of})`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (n: number) => `$${n.toFixed(4)}`;

async function main() {
  process.loadEnvFile(".env.local");
  const env = getEnv();
  const runs = Number(process.env.MEASURE_RUNS ?? 1);
  const requested = process.env.MEASURE_MODEL;
  const agentModel = isModelId(requested) ? requested : AGENT_MODEL_ID;
  const only = process.env.MEASURE_ONLY?.split(",").map((s) => s.trim());
  const prompts = parseAgentPrompts(await readFile(PROMPTS, "utf8")).filter(
    (p) => !only || only.includes(p.id),
  );
  const graph = getAgentGraph(agentModel);

  console.log(
    `Drafting ${agentModel}, checking ${REFLECTION_MODEL_ID}, prompts ${PROMPT_VERSION} and ${REFLECTION_PROMPT_VERSION}, ` +
      `up to ${env.AGENT_MAX_ITERATIONS} revisions, ${REVISION_CUTOFF_MS / 1000} s revision cutoff.`,
  );
  console.log(`${prompts.length} prompts, ${runs} run(s) each.\n`);

  const records: RunRecord[] = [];
  const raw: unknown[] = [];
  let failures = 0;

  for (const prompt of prompts) {
    for (let i = 0; i < runs; i++) {
      const events: RunEvent[] = [];
      let finalAnswer = "";
      const start = performance.now();
      try {
        const updates = await graph.stream(
          { messages: [new HumanMessage(prompt.input)] },
          { ...agentRunConfig(prompt.world_id), streamMode: "updates" },
        );
        for await (const chunk of updates) {
          for (const [node, update] of Object.entries(
            chunk as Record<string, RunEvent["update"]>,
          )) {
            events.push({ node, atMs: performance.now() - start, update });
            if (typeof update.draftAnswer === "string") finalAnswer = update.draftAnswer;
          }
        }
      } catch (error) {
        failures++;
        console.log(
          `${prompt.id} run ${i + 1}: FAILED (${error instanceof Error ? error.message : error})`,
        );
        continue;
      }
      const record = summarizeRun({
        promptId: prompt.id,
        temptsRuleBreak: prompt.tempts_rule_break,
        expectedTools: prompt.expected_tools,
        events,
        totalMs: performance.now() - start,
        maxIterations: env.AGENT_MAX_ITERATIONS,
        agentModel,
        reflectionModel: REFLECTION_MODEL_ID,
      });
      records.push(record);
      raw.push({ ...record, finalAnswer });
      console.log(
        `${prompt.id.padEnd(22)} ${sec(record.totalMs).padStart(7)} | first ${String(record.firstVerdict).padEnd(10)} final ${String(record.finalVerdict).padEnd(10)} | revisions ${record.iterations} | ${record.endedBy} | ${usd(record.costUsd)}`,
      );
    }
  }
  if (records.length === 0) throw new Error("every run failed");

  const s = summarizeRuns(records);
  console.log(`\nRuns ok: ${records.length}, failed: ${failures}\n`);

  console.log("| Metric | First drafts | Final answers |");
  console.log("| --- | ---: | ---: |");
  console.log(
    `| Rule violations, all prompts | ${pct(s.violations.firstDrafts)} | ${pct(s.violations.finalAnswers)} |`,
  );
  console.log(
    `| Rule violations, prompts that tempt | ${pct(s.violations.firstDraftsTempting)} | ${pct(s.violations.finalAnswersTempting)} |`,
  );
  console.log(
    `| Rule violations, plain prompts | ${pct(s.violations.firstDraftsPlain)} | ${pct(s.violations.finalAnswersPlain)} |`,
  );

  console.log("\n| Loop | Value |");
  console.log("| --- | ---: |");
  console.log(`| Revisions per run, mean | ${s.iterations.mean.toFixed(2)} |`);
  console.log(`| Runs with a revision | ${s.iterations.withRevision} of ${s.runs} |`);
  console.log(`| Ended valid | ${s.ended.valid} |`);
  console.log(`| Ended at the revision limit | ${s.ended.revisionLimit} |`);
  console.log(`| Ended at the time limit | ${s.ended.timeLimit} |`);
  console.log(`| Ended with the check unavailable | ${s.ended.checkUnavailable} |`);
  console.log(`| Answers with a caveat | ${s.caveats} |`);
  console.log(`| Empty first drafts (not a rule violation) | ${s.emptyFirstDrafts} |`);
  console.log(`| Empty final answers | ${s.emptyFinalAnswers} |`);

  console.log("\n| Per query | mean | p50 | p95 |");
  console.log("| --- | ---: | ---: | ---: |");
  const row = (
    label: string,
    v: { mean: number; p50: number; p95: number },
    f: (n: number) => string,
  ) => console.log(`| ${label} | ${f(v.mean)} | ${f(v.p50)} | ${f(v.p95)} |`);
  row("Total latency", s.latencyMs, sec);
  row("Reflection overhead, latency", s.overheadMs, sec);
  row("  of which checks", s.checkMs, sec);
  row("  of which revisions", s.revisionMs, sec);
  row("Cost of the run", s.costUsd, usd);
  row("Reflection overhead, cost", s.overheadCostUsd, usd);
  row("Answer length (words)", s.answerWords, (n) => n.toFixed(0));
  console.log(
    `\nOverhead share: ${(s.overheadShareOfLatency * 100).toFixed(0)}% of latency, ${(s.overheadShareOfCost * 100).toFixed(0)}% of cost (mean of per-run shares).`,
  );
  console.log(
    `Check tokens per run: ${s.checkTokens.input.toFixed(0)} in, ${s.checkTokens.output.toFixed(0)} out. Revision tokens per run: ${s.revisionTokens.input.toFixed(0)} in, ${s.revisionTokens.output.toFixed(0)} out.`,
  );
  console.log(
    `Expected tools all called: ${s.expectedToolsCalled} of ${s.runs} runs. Total spend: ${usd(records.reduce((t, r) => t + r.costUsd, 0))}.`,
  );

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    `${OUT_DIR}measure-agent-latest.json`,
    JSON.stringify({ agentModel, summary: s, runs: raw }, null, 2),
  );
  console.log("\nRaw record: apps/web/scripts/.out/measure-agent-latest.json");
  // The database connection of the lore search stays open, so end the process here.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
