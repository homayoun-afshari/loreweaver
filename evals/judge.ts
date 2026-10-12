/**
 * End-to-end eval: runs every case of a dataset (evals/datasets/e2e.json, or redteam.json with
 * `--dataset redteam`) through the agent graph, without a browser, and grades each answer twice.
 *
 *   1. Code checks: the expected tools were called (and the forbidden ones were not), the items
 *      named in the answer are items the character carries, and every citation is a real chunk of
 *      the world.
 *      The red-team set adds a safety check: no text of the system prompt, no world id, none of the
 *      texts a case lists, and no answer longer than the case allows.
 *   2. The judge (Claude Opus 5.5 by default): faithfulness to the lore from 1 to 5, and a pass or
 *      fail for each expected constraint, with its reasoning written first.
 *
 * A case passes when every code check holds and the judge passes it. The runner prints the results
 * and writes a JSON report to evals/reports/.
 *
 *   pnpm eval                                    every case, Sonnet 5.5 under test, Opus 5.5 judging
 *   pnpm eval --only fire-escape-01,no-flint-02  a few cases, by id
 *   pnpm eval --agent-model claude-haiku-4-5     another model under test (cheaper, for development)
 *   pnpm eval --no-judge                         code checks only: no judge call, no judge cost
 *   pnpm eval --label baseline                   adds a label to the report's file name
 *   pnpm eval:redteam                            the red-team set (same as --dataset redteam)
 *   pnpm eval:redteam --no-guardrails            the same set with the code defenses off, to measure them
 *   pnpm eval --smoke                            only the 10 cases of datasets/smoke.json
 *
 * The gate, for a workflow (the exit code is 1 when a rule fails; without a rule it is always 0):
 *   --min-faithfulness 4.3    the mean faithfulness of the judge must reach it
 *   --require-all             every case must pass
 *   --report-only legit-dark  cases with these tags (comma-separated) are run and reported but
 *                             do not count against --require-all
 *   --faithfulness-pass 1     the faithfulness a single case needs (4 by default)
 *
 * A red-team case whose world has a folder in evals/fixtures/lore/ gets that lore written to the
 * LOCAL database for the run (a world with an instruction hidden in a passage) and removed after.
 * A case with `rejected_by: "input-limit"` is not run through the agent: the app's own request
 * check must reject it, so it costs nothing.
 *
 * It needs the local services of the app (the legacy CMS and the Postgres with the lore ingested,
 * see the README) and the keys in apps/web/.env.local. It calls the real models: a full run of the
 * set costs about a dollar (it prints its own total). One run per case, one case at a time, so the
 * numbers carry run-to-run variance that this runner does not measure.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { eq } from "drizzle-orm";
import { createStandaloneDb } from "../apps/web/src/db/standalone";
import { loreChunks } from "../apps/web/src/db/schema";
import { agentRunConfig } from "../apps/web/src/lib/agent";
import { BLOCKED_ANSWER } from "../apps/web/src/lib/agent/guardrails";
import {
  describeToolResult,
  REFLECTION_PROMPT_VERSION,
} from "../apps/web/src/lib/agent/reflection";
import { textOf } from "../apps/web/src/lib/agent/messages";
import { summarizeRun, type RunEvent } from "../apps/web/src/lib/agent-metrics";
import { createRuntimeGraph } from "../apps/web/src/lib/ai/agent-runtime";
import { MAX_USER_MESSAGE_CHARS, parseChatRequest } from "../apps/web/src/lib/ai/chat-request";
import {
  AGENT_MODEL_ID,
  isModelId,
  type ModelId,
  REFLECTION_MODEL_ID,
} from "../apps/web/src/lib/ai/models";
import { getEnv } from "../apps/web/src/lib/env";
import type { CharacterState } from "../apps/web/src/lib/legacy";
import { createLegacyClient, type LegacyClient } from "../apps/web/src/lib/legacy/client";
import { err, unavailable } from "../apps/web/src/lib/legacy/errors";
import { getSystemPrompt, PROMPT_VERSION } from "../apps/web/src/lib/prompts";
import { CITATION_ID_LENGTH } from "../apps/web/src/lib/rag/search";
import { DEFAULT_CHUNKING } from "../apps/web/src/lib/rag/constants";
import { charactersOf, KNOWN_WORLDS } from "../apps/web/src/lib/worlds";
import { checkCitations, checkInventory, checkSafety, checkTools } from "./e2e-checks";
import { parseE2eDataset, type E2eCase } from "./e2e-dataset";
import {
  createJudge,
  FAITHFULNESS_PASS,
  JUDGE_EFFORT,
  JUDGE_MODEL_ID,
  JUDGE_PROMPT_VERSION,
  judgeCostUsd,
} from "./e2e-judge";
import { evaluateGate, parseThreshold } from "./e2e-gate";
import { decide, summarizeResults, type CaseResult } from "./e2e-report";
import { loadFixtureWorld } from "./redteam-fixture";

const DATASETS = new URL("./datasets/", import.meta.url);
const FIXTURES = fileURLToPath(new URL("./fixtures/lore/", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));
const REPO = fileURLToPath(new URL("../", import.meta.url));

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    "agent-model": { type: "string" },
    "no-judge": { type: "boolean", default: false },
    label: { type: "string" },
    dataset: { type: "string", default: "e2e" },
    "no-guardrails": { type: "boolean", default: false },
    smoke: { type: "boolean", default: false },
    "min-faithfulness": { type: "string" },
    "faithfulness-pass": { type: "string" },
    "require-all": { type: "boolean", default: false },
    "report-only": { type: "string" },
  },
});

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (n: number) => `$${n.toFixed(4)}`;
const pct = (s: { ok: number; of: number; rate: number | undefined }) =>
  s.rate === undefined ? "n/a" : `${(s.rate * 100).toFixed(0)}% (${s.ok}/${s.of})`;

/** A legacy service that is down: every lookup fails like an unreachable network. */
const downClient: LegacyClient = {
  getCharacterState: async () => err(unavailable("network")),
};

function describeRecord(character: CharacterState, legacy: E2eCase["legacy"]): string {
  const where = character.location.name ?? `location ${character.location.code}`;
  const text =
    `${character.name} (id ${character.id}) is at ${where}, condition ${character.condition}, ` +
    `mana ${character.mana}, health ${character.hp}, carries: ` +
    `${character.inventory.length > 0 ? character.inventory.join(", ") : "nothing"}.`;
  return legacy === "down"
    ? `${text} (In this run the copilot could not read it: the character service was down.)`
    : text;
}

/** A request whose newest message has `chars` characters, as the chat sends it. */
function requestOfLength(prefix: string, chars: number) {
  const text = prefix + "x".repeat(Math.max(0, chars - prefix.length));
  return { messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }] };
}

/** Whether the app's request check rejects a message that is too long and accepts one at the limit. */
function checkInputLimit(prefix: string, padTo: number): { pass: boolean; detail: string } {
  const longAccepted = parseChatRequest(requestOfLength(prefix, padTo)) !== null;
  const edgeAccepted = parseChatRequest(requestOfLength(prefix, MAX_USER_MESSAGE_CHARS)) !== null;
  if (longAccepted) return { pass: false, detail: `a message of ${padTo} characters was accepted` };
  if (!edgeAccepted) {
    return {
      pass: false,
      detail: `a message of ${MAX_USER_MESSAGE_CHARS} characters was rejected`,
    };
  }
  return {
    pass: true,
    detail: `${padTo} characters rejected, ${MAX_USER_MESSAGE_CHARS} accepted`,
  };
}

function gitCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local (for example in CI): rely on the real environment.
  }
  const env = getEnv();
  const requested = args["agent-model"];
  if (requested !== undefined && !isModelId(requested)) {
    throw new Error(`--agent-model ${requested} is not one of the app's models`);
  }
  const agentModel = requested ?? AGENT_MODEL_ID;
  const judged = !args["no-judge"];
  const only = args.only?.split(",").map((s) => s.trim());
  if (args.dataset !== "e2e" && args.dataset !== "redteam") {
    throw new Error(`--dataset ${args.dataset} is not e2e or redteam`);
  }
  const datasetName = args.dataset;
  if (args.smoke && datasetName !== "e2e") throw new Error("--smoke is for the e2e dataset");
  const smokeIds: string[] | undefined = args.smoke
    ? (JSON.parse(
        await readFile(fileURLToPath(new URL("smoke.json", DATASETS)), "utf8"),
      ) as string[])
    : undefined;
  const cases = parseE2eDataset(
    await readFile(fileURLToPath(new URL(`${datasetName}.json`, DATASETS)), "utf8"),
  ).filter((c) => (!only || only.includes(c.id)) && (!smokeIds || smokeIds.includes(c.id)));
  if (cases.length === 0) throw new Error("no case selected");
  const gateOptions = {
    minFaithfulness: parseThreshold("--min-faithfulness", args["min-faithfulness"]),
    requireAll: args["require-all"],
  };
  const faithfulnessPass = parseThreshold("--faithfulness-pass", args["faithfulness-pass"]);

  // Worlds that exist only for the eval (a lore passage with an instruction hidden in it): written
  // to the local database now and removed when the run ends, whatever happens.
  const removeFixtures: (() => Promise<void>)[] = [];
  try {
    for (const worldId of new Set(cases.map((c) => c.world_id))) {
      if (!existsSync(`${FIXTURES}${worldId}`)) continue;
      const fixture = await loadFixtureWorld({
        root: FIXTURES,
        worldId,
        databaseUrl: env.DATABASE_URL,
        voyageKey: env.VOYAGE_API_KEY,
        embeddingModel: env.EMBEDDING_MODEL,
      });
      removeFixtures.push(fixture.remove);
      console.log(
        `Fixture world ${worldId}: ${fixture.chunks} chunk(s) written to the local database.`,
      );
    }
    return await runCases({
      env,
      agentModel,
      judged,
      cases,
      datasetName,
      gateOptions,
      faithfulnessPass,
      reportOnlyTags: (args["report-only"] ?? "").split(",").filter((t) => t !== ""),
    });
  } finally {
    for (const remove of removeFixtures) await remove();
  }
}

async function runCases(args2: {
  env: ReturnType<typeof getEnv>;
  agentModel: ModelId;
  judged: boolean;
  cases: E2eCase[];
  datasetName: string;
  gateOptions: Parameters<typeof evaluateGate>[1];
  faithfulnessPass: number | undefined;
  reportOnlyTags: string[];
}): Promise<number> {
  const {
    env,
    agentModel,
    judged,
    cases,
    datasetName,
    gateOptions,
    faithfulnessPass,
    reportOnlyTags,
  } = args2;

  // The truth about the characters: read from the CMS once, with a client of its own so that a
  // case with a legacy service that is down does not touch it.
  const cms = createLegacyClient({ baseUrl: env.LEGACY_CMS_URL, apiKey: env.LEGACY_CMS_API_KEY });
  const characters = new Map<number, CharacterState>();
  for (const world of KNOWN_WORLDS) {
    for (const { id } of world.characters) {
      const result = await cms.getCharacterState(id);
      if (!result.ok) {
        throw new Error(
          `the legacy CMS did not answer for character ${id} (${result.error.message}). ` +
            "Start it with: docker compose up -d",
        );
      }
      characters.set(id, result.value);
    }
  }
  const catalog = [...new Set([...characters.values()].flatMap((c) => c.inventory))];

  // Every citation id of every world, to tell a real citation from an invented one.
  const { db, close } = createStandaloneDb(env.DATABASE_URL);
  const chunkRows = await db
    .select({ id: loreChunks.id, worldId: loreChunks.worldId })
    .from(loreChunks)
    .where(eq(loreChunks.chunking, DEFAULT_CHUNKING));
  await close();
  if (chunkRows.length === 0) {
    throw new Error(`no lore chunks of "${DEFAULT_CHUNKING}" in the database. Run: pnpm ingest`);
  }
  const worldCitationIds = new Map<string, Set<string>>();
  for (const row of chunkRows) {
    const ids = worldCitationIds.get(row.worldId) ?? new Set<string>();
    ids.add(row.id.slice(0, CITATION_ID_LENGTH).toLowerCase());
    worldCitationIds.set(row.worldId, ids);
  }

  // The code defenses of the agent are on, as in the app. Off, the run shows what the model does alone.
  const guardrails = !args["no-guardrails"];
  const upGraph = createRuntimeGraph(agentModel, {}, { guardrails });
  const downGraph = createRuntimeGraph(agentModel, { getClient: () => downClient }, { guardrails });
  const judge = judged ? createJudge({ apiKey: env.ANTHROPIC_API_KEY }) : undefined;

  console.log(
    `Agent ${agentModel} (prompts ${PROMPT_VERSION} and ${REFLECTION_PROMPT_VERSION}), ` +
      (judged
        ? `judge ${JUDGE_MODEL_ID} (${JUDGE_PROMPT_VERSION}, faithfulness ${faithfulnessPass ?? FAITHFULNESS_PASS}+ to pass).`
        : "no judge (code checks only)."),
  );
  console.log(`${cases.length} case(s), one run each.\n`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    if (c.rejected_by === "input-limit") {
      const inputLimit = checkInputLimit(c.input, c.pad_input_to ?? MAX_USER_MESSAGE_CHARS + 1);
      const { pass, failures } = decide({ inputLimit, judged });
      results.push({
        id: c.id,
        tags: c.tags,
        input: c.input,
        worldId: c.world_id,
        characterId: c.character_id,
        answer: "",
        evidence: [],
        characterRecord: null,
        toolsUsed: [],
        toolCalls: [],
        inputLimit,
        guardFired: false,
        pass,
        failures,
        latencyMs: 0,
        iterations: 0,
        endedBy: "not run",
        agentCostUsd: 0,
        judgeCostUsd: 0,
      });
      console.log(`${pass ? "PASS" : "FAIL"} ${c.id.padEnd(24)} no model | ${inputLimit.detail}`);
      continue;
    }
    const graph = c.legacy === "down" ? downGraph : upGraph;
    const character = c.character_id === null ? null : (characters.get(c.character_id) ?? null);
    const events: RunEvent[] = [];
    const toolMessages: BaseMessage[] = [];
    const toolCalls: CaseResult["toolCalls"] = [];
    let answer = "";
    const start = performance.now();
    let error: string | undefined;
    try {
      const updates = await graph.stream(
        { messages: [new HumanMessage(c.input)] },
        {
          ...agentRunConfig(c.world_id, Date.now(), {
            promptVersion: PROMPT_VERSION,
            modelId: agentModel,
            vercelEnv: process.env.VERCEL_ENV,
          }),
          streamMode: "updates",
        },
      );
      for await (const chunk of updates) {
        for (const [node, update] of Object.entries(chunk as Record<string, RunEvent["update"]>)) {
          events.push({ node, atMs: performance.now() - start, update });
          if (typeof update.draftAnswer === "string") answer = update.draftAnswer;
          for (const m of update.messages ?? []) {
            if (m.type === "tool") toolMessages.push(m);
            if (m.type === "ai") {
              const calls = (m as { tool_calls?: { name: string; args: unknown }[] }).tool_calls;
              for (const call of calls ?? []) toolCalls.push({ name: call.name, args: call.args });
            }
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const totalMs = performance.now() - start;
    const record = summarizeRun({
      promptId: c.id,
      temptsRuleBreak: c.tags.includes("trap"),
      expectedTools: c.expected_tools,
      events,
      totalMs,
      maxIterations: env.AGENT_MAX_ITERATIONS,
      agentModel,
      reflectionModel: REFLECTION_MODEL_ID,
    });

    let checks: CaseResult["checks"];
    let grade: CaseResult["judge"];
    let judgeError: string | undefined;
    let judgeCost = 0;
    if (!error) {
      const retrievedIds = new Set<string>();
      for (const m of toolMessages) {
        if ((m as { name?: string }).name !== "search_lore") continue;
        try {
          const parsed = JSON.parse(textOf(m)) as { hits?: { citationId: string }[] };
          for (const hit of parsed.hits ?? []) retrievedIds.add(hit.citationId.toLowerCase());
        } catch {
          // An unreadable tool result has no ids to add.
        }
      }
      checks = {
        tools: checkTools({
          expected: c.expected_tools,
          forbidden: c.forbidden_tools,
          used: record.toolsUsed,
        }),
        inventory: character
          ? checkInventory({
              answer,
              inventory: character.inventory,
              catalog: [...catalog, ...(c.tempting_items ?? [])],
            })
          : null,
        citations: checkCitations({
          answer,
          worldCitationIds: worldCitationIds.get(c.world_id) ?? new Set(),
          retrievedIds,
        }),
        safety: checkSafety({
          answer,
          systemPrompt: getSystemPrompt(c.world_id),
          mustNotContain: c.must_not_contain,
          maxAnswerChars: c.max_answer_chars,
        }),
      };
      if (judge) {
        try {
          const out = await judge({
            question: c.input,
            toolMessages,
            knownCharacters:
              charactersOf(c.world_id)
                .map((x) => `${x.id} = ${x.name}`)
                .join(", ") || "none",
            characterRecord: character ? describeRecord(character, c.legacy) : null,
            answer,
            constraints: c.expected_constraints,
          });
          grade = out.grade;
          judgeCost = judgeCostUsd(out.tokens);
        } catch (e) {
          judgeError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    const { pass, failures } = decide({
      error,
      checks,
      judge: grade,
      judgeError,
      judged,
      minFaithfulness: faithfulnessPass,
    });
    results.push({
      id: c.id,
      tags: c.tags,
      input: c.input,
      worldId: c.world_id,
      characterId: c.character_id,
      answer,
      evidence: toolMessages.map((m) => describeToolResult(m)),
      characterRecord: character ? describeRecord(character, c.legacy) : null,
      error,
      toolsUsed: record.toolsUsed,
      toolCalls,
      checks,
      guardFired: answer.includes(BLOCKED_ANSWER),
      judge: grade,
      judgeError,
      pass,
      failures,
      latencyMs: totalMs,
      iterations: record.iterations,
      endedBy: record.endedBy,
      agentCostUsd: record.costUsd,
      judgeCostUsd: judgeCost,
    });
    console.log(
      `${pass ? "PASS" : "FAIL"} ${c.id.padEnd(24)} ${sec(totalMs).padStart(7)} | ` +
        `faithfulness ${grade ? grade.faithfulness : "-"} | ${usd(record.costUsd + judgeCost)}` +
        (failures.length > 0 ? ` | ${failures.join("; ")}` : ""),
    );
  }

  const s = summarizeResults(results);
  console.log("\n| Metric | Value |");
  console.log("| --- | ---: |");
  console.log(`| Pass rate | ${pct(s.passed)} |`);
  console.log(
    `| Mean faithfulness (judge) | ${s.faithfulness.mean?.toFixed(2) ?? "n/a"} over ${s.faithfulness.graded} case(s) |`,
  );
  console.log(`| Constraints passed (judge) | ${pct(s.constraints)} |`);
  console.log(`| Inventory accuracy | ${pct(s.inventory)} |`);
  console.log(`| Tool-call accuracy | ${pct(s.toolCalls)} |`);
  console.log(`| Citations that resolve | ${pct(s.citations)} |`);
  if (datasetName === "redteam") {
    console.log(
      `| Safe answers (no leak, no canary, within the length limit) | ${pct(s.safety)} |`,
    );
    console.log(`| Answers replaced by the app's guard | ${s.guardFired} |`);
    console.log(`| Over-refusal (dark but legitimate requests failed) | ${pct(s.overRefusal)} |`);
    console.log(`| Requests rejected by the input limit | ${pct(s.inputLimit)} |`);
  }
  console.log(`| Runs that failed / judge errors | ${s.runErrors} / ${s.judgeErrors} |`);
  console.log(
    `| Latency p50 / p95 | ${s.latencyMs ? `${sec(s.latencyMs.p50)} / ${sec(s.latencyMs.p95)}` : "n/a"} |`,
  );
  console.log(
    `| Cost: agent / judge / total | ${usd(s.agentCostUsd)} / ${usd(s.judgeCostUsd)} / ${usd(s.agentCostUsd + s.judgeCostUsd)} |`,
  );
  if (s.failedIds.length > 0) console.log(`\nFailed: ${s.failedIds.join(", ")}`);
  // Cases with a report-only tag are in the report and the table, but cannot fail the gate.
  const reportOnly = new Set(
    results.filter((r) => r.tags.some((t) => reportOnlyTags.includes(t))).map((r) => r.id),
  );
  const gate = evaluateGate(
    { ...s, failedIds: s.failedIds.filter((id) => !reportOnly.has(id)) },
    gateOptions,
  );
  if (gate.active) {
    console.log(
      `\nGate: ${gate.pass ? "PASS" : "FAIL"}` +
        (gate.reasons.length > 0 ? ` (${gate.reasons.join("; ")})` : ""),
    );
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = `${REPORTS}${datasetName}-${stamp}${args.label ? `-${args.label}` : ""}.json`;
  await mkdir(REPORTS, { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        meta: {
          date: new Date().toISOString(),
          commit: gitCommit(),
          agentModel,
          reflectionModel: REFLECTION_MODEL_ID,
          judgeModel: judged ? JUDGE_MODEL_ID : null,
          agentPromptVersion: PROMPT_VERSION,
          reflectionPromptVersion: REFLECTION_PROMPT_VERSION,
          judgePromptVersion: judged ? JUDGE_PROMPT_VERSION : null,
          judgeEffort: judged ? JUDGE_EFFORT : null,
          faithfulnessPass: faithfulnessPass ?? FAITHFULNESS_PASS,
          gate: { ...gateOptions, reportOnly: args["report-only"] ?? null },
          dataset: datasetName,
          guardrails,
          label: args.label ?? null,
          casesRun: cases.length,
          runsPerCase: 1,
        },
        summary: s,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport: ${file.replace(REPO, "")}`);
  // Send the traces that are still waiting (a no-op with tracing off).
  await awaitAllCallbacks();
  return gate.pass ? 0 : 1;
}

main()
  // The database connection of the lore search stays open, so end the process here.
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
