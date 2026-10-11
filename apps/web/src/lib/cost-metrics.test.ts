import { describe, expect, it } from "vitest";
import {
  buildQueries,
  projectMonthly,
  summarize,
  tokensOf,
  type LlmCall,
  type RootRun,
} from "./cost-metrics";

const root = (traceId: string, over: Partial<RootRun> = {}): RootRun => ({
  traceId,
  startedAt: "2026-10-11T18:00:00Z",
  latencyMs: 10_000,
  status: "success",
  env: "development",
  model: "claude-sonnet-5-5",
  promptVersion: "agent.v3",
  ...over,
});

const call = (traceId: string, over: Partial<LlmCall> = {}): LlmCall => ({
  traceId,
  model: "claude-sonnet-5-5",
  node: "agent",
  promptTokens: 0,
  completionTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  langsmithCostUsd: undefined,
  ...over,
});

describe("tokensOf", () => {
  it("takes the cached tokens out of the input, which includes them", () => {
    const t = tokensOf(
      call("t", { promptTokens: 3000, cacheRead: 2000, cacheWrite: 500, completionTokens: 40 }),
    );
    expect(t).toEqual({ input: 500, cacheRead: 2000, cacheWrite: 500, output: 40 });
  });
});

describe("buildQueries", () => {
  it("prices every call of a trace by the model that made it", () => {
    const { queries } = buildQueries(
      [root("a")],
      [
        // Sonnet: 1,000 in and 100 out = 0.002 + 0.001
        call("a", { promptTokens: 1000, completionTokens: 100 }),
        // Haiku: 2,000 in and 50 out = 0.002 + 0.00025
        call("a", {
          model: "claude-haiku-4-5",
          node: "reflect",
          promptTokens: 2000,
          completionTokens: 50,
        }),
      ],
    );
    expect(queries).toHaveLength(1);
    expect(queries[0].costUsd).toBeCloseTo(0.003 + 0.00225, 8);
    expect(queries[0].calls).toBe(2);
    expect(queries[0].costByNode.agent).toBeCloseTo(0.003, 8);
    expect(queries[0].costByNode.reflect).toBeCloseTo(0.00225, 8);
    expect(queries[0].tokens).toEqual({ input: 3000, cacheRead: 0, cacheWrite: 0, output: 150 });
  });

  it("prices cache reads and writes at their own prices", () => {
    const { queries } = buildQueries(
      [root("a")],
      [call("a", { promptTokens: 1000, cacheRead: 600, cacheWrite: 200, completionTokens: 0 })],
    );
    // 200 in × $2 + 600 read × $0.10 + 200 write × $2.50 per million.
    expect(queries[0].costUsd).toBeCloseTo((200 * 2 + 600 * 0.1 + 200 * 2.5) / 1e6, 10);
    expect(queries[0].costByType.cacheRead).toBeCloseTo((600 * 0.1) / 1e6, 10);
  });

  it("leaves out and counts traces that cannot be priced", () => {
    const { queries, skipped } = buildQueries(
      [root("ok"), root("failed", { status: "error" }), root("empty"), root("odd")],
      [
        call("ok", { promptTokens: 10 }),
        call("failed", { promptTokens: 10 }),
        call("odd", { model: "gpt-something", promptTokens: 10 }),
      ],
    );
    expect(queries.map((q) => q.traceId)).toEqual(["ok"]);
    expect(skipped).toEqual({ notSuccessful: 1, noCalls: 1, unknownModel: 1 });
  });

  it("sums the cost LangSmith computed, for a cross-check", () => {
    const { queries } = buildQueries(
      [root("a")],
      [call("a", { langsmithCostUsd: 0.001 }), call("a", { langsmithCostUsd: 0.002 })],
    );
    expect(queries[0].langsmithCostUsd).toBeCloseTo(0.003, 8);
  });
});

describe("summarize", () => {
  const queries = buildQueries(
    [root("a", { latencyMs: 4000 }), root("b", { latencyMs: 8000 })],
    [
      call("a", { promptTokens: 1_000_000, completionTokens: 0 }), // $2
      call("b", { promptTokens: 1_000_000, completionTokens: 100_000 }), // $2 + $1
    ],
  ).queries;

  it("gives the mean, p50 and p95 of cost and latency", () => {
    const s = summarize(queries);
    expect(s.queries).toBe(2);
    expect(s.costUsd.mean).toBeCloseTo(2.5);
    expect(s.costUsd.p50).toBeCloseTo(2);
    expect(s.costUsd.p95).toBeCloseTo(3);
    expect(s.latencyMs).toEqual({ mean: 6000, p50: 4000, p95: 8000 });
  });

  it("shows where the money goes", () => {
    const s = summarize(queries);
    expect(s.costShareByType.input).toBeCloseTo(4 / 5);
    expect(s.costShareByType.output).toBeCloseTo(1 / 5);
    expect(s.costShareByNode.agent).toBeCloseTo(1);
  });

  it("reports the cache hit rate as the share of input read from the cache", () => {
    const s = summarize(
      buildQueries([root("a")], [call("a", { promptTokens: 1000, cacheRead: 750 })]).queries,
    );
    expect(s.cacheHitRate).toBeCloseTo(0.75);
  });

  it("refuses to summarize nothing", () => {
    expect(() => summarize([])).toThrow();
  });
});

describe("projectMonthly", () => {
  it("is cost per query × queries a day × 30 × authors", () => {
    expect(projectMonthly(0.02, 20, 1000)).toBeCloseTo(12_000);
    expect(projectMonthly(0.025, 20, 100)).toBeCloseTo(1_500);
  });
});
