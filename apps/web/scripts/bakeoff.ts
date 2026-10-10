/**
 * Mini model bake-off: sends the same prompts through POST /api/chat to each model and
 * records time to first token (TTFT), total latency, output tokens and cost.
 * Quality is judged by a human afterwards, from the saved responses.
 *
 *   pnpm dev                                   # terminal 1 (needs ANTHROPIC_API_KEY)
 *   pnpm --filter web exec tsx scripts/bakeoff.ts   # terminal 2
 *
 * The model override only works outside production (see src/lib/ai/models.ts).
 */
import { writeFileSync } from "node:fs";
import { costUsd, isModelId, MODELS, type ModelId } from "../src/lib/ai/models";

const baseUrl = (process.env.BAKEOFF_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const runs = Number(process.env.BAKEOFF_RUNS ?? 1);
const models: ModelId[] = (process.env.BAKEOFF_MODELS ?? "claude-haiku-4-5,claude-sonnet-5-5")
  .split(",")
  .filter(isModelId);

/** Five prompts that look like real Loreweaver questions: creative, rule check, honesty, list, tone. */
const prompts = [
  {
    id: "P1 plot ideas",
    text: "In my fantasy world magic costs mana and the Ice Citadel is frozen all year. Give me three plot complications for a heist there.",
  },
  {
    id: "P2 rule check",
    text: "A mage has 5 mana. Fireball costs 8 mana and Spark costs 2. Can she cast Fireball and then Spark? Answer in two sentences.",
  },
  {
    id: "P3 honesty",
    text: "What is the name of the blacksmith in my world?",
  },
  {
    id: "P4 structured list",
    text: "List four distinct factions for a world where the moon is a prison. One line each.",
  },
  {
    id: "P5 prose",
    text: "Describe a market at dusk in a city built inside a dead giant, in two sentences.",
  },
];

type Sample = {
  model: ModelId;
  prompt: string;
  ttftMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  text: string;
};

/** Sends one prompt and reads the SSE stream, timing the first text chunk and the end. */
async function runOnce(model: ModelId, prompt: { id: string; text: string }): Promise<Sample> {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: prompt.text }] }],
    }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const decoder = new TextDecoder();
  let buffer = "";
  let ttftMs = 0;
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line; keep the unfinished tail for the next chunk.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      if (!event.startsWith("data: ") || event === "data: [DONE]") continue;
      const part = JSON.parse(event.slice(6));
      if (part.type === "text-delta") {
        if (!ttftMs) ttftMs = performance.now() - start;
        text += part.delta;
      } else if (part.type === "message-metadata") {
        inputTokens = part.messageMetadata?.inputTokens ?? 0;
        outputTokens = part.messageMetadata?.outputTokens ?? 0;
      } else if (part.type === "error") {
        throw new Error(part.errorText);
      }
    }
  }

  return {
    model,
    prompt: prompt.id,
    ttftMs,
    totalMs: performance.now() - start,
    inputTokens,
    outputTokens,
    costUsd: costUsd(model, inputTokens, outputTokens),
    text: text.trim(),
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function main() {
  const samples: Sample[] = [];
  for (const model of models) {
    for (const prompt of prompts) {
      for (let run = 0; run < runs; run++) {
        const sample = await runOnce(model, prompt);
        samples.push(sample);
        console.log(
          `${model} | ${prompt.id} | TTFT ${Math.round(sample.ttftMs)} ms | total ${Math.round(sample.totalMs)} ms | out ${sample.outputTokens} tok`,
        );
      }
    }
  }

  console.log(
    "\n| Model | Avg TTFT (ms) | Avg total (ms) | Avg output tokens | Out tok/s | Cost / 5 prompts (USD) |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const model of models) {
    const rows = samples.filter((s) => s.model === model);
    const decodeTps = avg(rows.map((r) => r.outputTokens / ((r.totalMs - r.ttftMs) / 1000)));
    const cost = rows.reduce((sum, r) => sum + r.costUsd, 0) / runs;
    console.log(
      `| ${MODELS[model].label} | ${Math.round(avg(rows.map((r) => r.ttftMs)))} | ${Math.round(avg(rows.map((r) => r.totalMs)))} | ${Math.round(avg(rows.map((r) => r.outputTokens)))} | ${decodeTps.toFixed(0)} | ${cost.toFixed(4)} |`,
    );
  }

  // Full answers, so a human can score quality afterwards.
  const out = samples.map((s) => `## ${s.model} | ${s.prompt}\n\n${s.text}\n`).join("\n");
  writeFileSync("../../docs/bakeoff-responses.md", `# Bake-off responses\n\n${out}`);
  console.log("\nFull responses written to docs/bakeoff-responses.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
