/**
 * How long the chat's `search_lore` tool takes, seen from the outside: the time between the model
 * calling the tool and the tool's result arriving in the stream. That is the whole search as the
 * app runs it (embed the question, query the database, build the result), on whatever app and
 * database MEASURE_URL points at, including a deployed one. The model is only used to decide to
 * call the tool, so each run costs about as much as one chat question.
 *
 *   MEASURE_URL        the app to ask (default http://localhost:3000)
 *   MEASURE_REQUESTS   how many questions to ask, one at a time (default 20)
 *   MEASURE_MODEL      local only: ask for another model (ignored by Preview and Production)
 *
 * Questions are the first lore questions of the retrieval eval set, each asked in its own world.
 * The time is taken by the client, so it includes the network between the client and the app for
 * the two events, a few milliseconds each. The model may search more than once for a question:
 * every call is timed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseDataset } from "../../../evals/retrieval-dataset";
import { mean, percentile } from "../src/lib/stats";

const DATASET = fileURLToPath(new URL("../../../evals/retrieval.jsonl", import.meta.url));
const baseUrl = (process.env.MEASURE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const requests = Number(process.env.MEASURE_REQUESTS ?? 20);
const model = process.env.MEASURE_MODEL;

const ms = (n: number) => `${Math.round(n)} ms`;

type ToolCall = { duration: number; hits: number | undefined; ok: boolean };

/** Sends one chat message and returns how long each search_lore call took. */
async function ask(world: string, text: string): Promise<{ calls: ToolCall[]; total: number }> {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `lw_world=${world}` },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
      ...(model ? { model } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const started = new Map<string, number>(); // toolCallId -> when the model called search_lore
  const calls: ToolCall[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const arrived = performance.now(); // events in one read share a time, which is fine at this scale
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line || line === "data: [DONE]") continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === "tool-input-available" && data.toolName === "search_lore") {
        started.set(data.toolCallId, arrived);
      } else if (data.type === "tool-output-available" && started.has(data.toolCallId)) {
        const output = data.output as { ok?: boolean; hits?: unknown[] };
        calls.push({
          duration: arrived - started.get(data.toolCallId)!,
          hits: output.hits?.length,
          ok: output.ok === true,
        });
      }
    }
  }
  return { calls, total: performance.now() - start };
}

async function main() {
  const cases = parseDataset(await readFile(DATASET, "utf8")).filter((c) => c.relevant.length > 0);
  const questions = Array.from({ length: requests }, (_, i) => cases[i % cases.length]);

  const durations: number[] = [];
  const totals: number[] = [];
  let failures = 0;
  let withoutHits = 0;
  let toolCalls = 0;
  let questionsWithoutSearch = 0;

  for (const c of questions) {
    try {
      const { calls, total } = await ask(c.world, c.query);
      totals.push(total);
      if (calls.length === 0) questionsWithoutSearch += 1;
      for (const call of calls) {
        toolCalls += 1;
        if (!call.ok) failures += 1;
        else if (call.hits === 0) withoutHits += 1;
        durations.push(call.duration);
      }
    } catch (error) {
      failures += 1;
      console.error(`failed (${c.id}):`, error instanceof Error ? error.message : error);
    }
  }

  console.log(
    `search_lore tool time at ${baseUrl}: ${requests} questions, ${toolCalls} tool calls`,
  );
  console.log(
    `  tool calls that failed or errored: ${failures}; returned no passages: ${withoutHits}; ` +
      `questions where the model did not search: ${questionsWithoutSearch}`,
  );
  if (durations.length > 0) {
    console.log(
      `  tool time  n=${durations.length} mean ${ms(mean(durations))} p50 ${ms(percentile(durations, 50))} ` +
        `p95 ${ms(percentile(durations, 95))} min ${ms(Math.min(...durations))} max ${ms(Math.max(...durations))}`,
    );
    console.log(
      `  whole question (model included)  p50 ${ms(percentile(totals, 50))} p95 ${ms(percentile(totals, 95))}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
