/**
 * Measures the chat with its tool, the way a browser experiences it. Each run sends
 * "What does Kael have on them?" to POST /api/chat and times the stream:
 *
 *   first UI    the model started the tool call, so the browser can show the card skeleton
 *   card        the tool result arrived, so the browser can show the Character Status Card
 *   TTFT        the first text token of the answer (client side)
 *   total       the end of the stream
 *
 * The route also reports its own timing (server side) in the final event, so the difference
 * between the two is the network and the browser-facing overhead.
 *
 *   pnpm dev                    # terminal 1 (also needs the legacy CMS: docker compose up -d legacy-cms)
 *   pnpm measure:chat           # terminal 2
 *
 * Against a deployment:  MEASURE_URL=https://loreweaver-nine.vercel.app pnpm measure:chat
 * See docs/METRICS.md for the exact commands and what the numbers mean.
 */
import { mean, percentile } from "../src/lib/stats";

const baseUrl = (process.env.MEASURE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const total = Number(process.env.MEASURE_REQUESTS ?? 10);
/** Honored only by a local server (a deployed one always uses its own model). */
const model = process.env.MEASURE_MODEL;
const question = "What does Kael have on them?";

type Sample = {
  firstUiMs: number;
  cardMs: number;
  ttftMs: number;
  totalMs: number;
  serverFirstUiMs: number;
  serverTtftMs: number;
  serverTotalMs: number;
  outputTokens: number;
  modelId: string;
  cardOk: boolean;
};

async function runOnce(): Promise<Sample> {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: question }] }],
    }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const sample: Sample = {
    firstUiMs: 0,
    cardMs: 0,
    ttftMs: 0,
    totalMs: 0,
    serverFirstUiMs: 0,
    serverTtftMs: 0,
    serverTotalMs: 0,
    outputTokens: 0,
    modelId: "",
    cardOk: false,
  };

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
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
      const elapsed = performance.now() - start;
      if (part.type === "tool-input-start" && !sample.firstUiMs) sample.firstUiMs = elapsed;
      if (part.type === "tool-output-available" && !sample.cardMs) {
        sample.cardMs = elapsed;
        sample.cardOk = part.output?.ok === true;
      }
      if (part.type === "text-delta" && !sample.ttftMs) sample.ttftMs = elapsed;
      if (part.type === "error") throw new Error(part.errorText);
      if (part.messageMetadata) {
        const m = part.messageMetadata;
        sample.serverFirstUiMs = m.serverFirstUiMs ?? 0;
        sample.serverTtftMs = m.serverTtftMs ?? 0;
        sample.serverTotalMs = m.serverTotalMs ?? 0;
        sample.outputTokens = m.outputTokens ?? 0;
        sample.modelId = m.modelId ?? "";
      }
    }
  }
  sample.totalMs = performance.now() - start;
  return sample;
}

const ms = (n: number) => `${Math.round(n)} ms`;

function row(label: string, values: number[]): string {
  // A server value of 0 means the server did not report it (an older deployment).
  values = values.filter((v) => v > 0);
  if (values.length === 0) return `| ${label} | n/a | n/a | n/a |`;
  return `| ${label} | ${ms(percentile(values, 50))} | ${ms(percentile(values, 95))} | ${ms(mean(values))} |`;
}

async function main() {
  console.log(`Target ${baseUrl}, ${total} runs of "${question}"`);
  const samples: Sample[] = [];
  let failures = 0;
  for (let i = 0; i < total; i++) {
    try {
      const sample = await runOnce();
      samples.push(sample);
      console.log(
        `run ${i + 1}: first UI ${Math.round(sample.firstUiMs)} ms | card ${Math.round(sample.cardMs)} ms | TTFT ${Math.round(sample.ttftMs)} ms | total ${Math.round(sample.totalMs)} ms${sample.cardOk ? "" : " | CARD ERROR"}`,
      );
    } catch (error) {
      failures++;
      console.log(`run ${i + 1}: failed (${error instanceof Error ? error.message : error})`);
    }
  }
  if (samples.length === 0) throw new Error("every run failed");

  const modelIds = [...new Set(samples.map((s) => s.modelId))].join(", ");
  const cardErrors = samples.filter((s) => !s.cardOk).length;
  console.log(
    `\nModel: ${modelIds}. Runs ok: ${samples.length}, failed: ${failures}, card showed an error: ${cardErrors}\n`,
  );
  console.log("| Metric | p50 | p95 | mean |");
  console.log("| --- | ---: | ---: | ---: |");
  console.log(
    row(
      "Time to first UI (skeleton), client",
      samples.map((s) => s.firstUiMs),
    ),
  );
  console.log(
    row(
      "Time to first UI (skeleton), server",
      samples.map((s) => s.serverFirstUiMs),
    ),
  );
  console.log(
    row(
      "Time to card (tool result), client",
      samples.map((s) => s.cardMs),
    ),
  );
  console.log(
    row(
      "TTFT (first text token), client",
      samples.map((s) => s.ttftMs),
    ),
  );
  console.log(
    row(
      "TTFT (first text token), server",
      samples.map((s) => s.serverTtftMs),
    ),
  );
  console.log(
    row(
      "Total, client",
      samples.map((s) => s.totalMs),
    ),
  );
  console.log(
    row(
      "Total, server",
      samples.map((s) => s.serverTotalMs),
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
