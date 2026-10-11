import { isModelId, usageCostUsd, type ModelId, type TokenUsage } from "@/lib/ai/models";
import { mean, percentile } from "./stats";

/**
 * The arithmetic of the cost report (evals/cost-report.ts), kept apart from LangSmith so that it
 * can be tested with numbers worked out by hand. cost = Σ over the model calls of the query of
 * (input × p_in + cached × p_cached + written to the cache × p_write + output × p_out).
 */

/** One model call of a trace, as LangSmith records it. */
export type LlmCall = {
  traceId: string;
  /** The model that was really called (`ls_model_name`), which prices the call. */
  model: string | undefined;
  /** The graph node that made the call: "agent" or "reflect". */
  node: string | undefined;
  /** All input tokens, including those read from or written to the cache. */
  promptTokens: number;
  completionTokens: number;
  cacheRead: number;
  cacheWrite: number;
  /** The cost LangSmith computed, to check this arithmetic against. */
  langsmithCostUsd: number | undefined;
};

/** The root run of a trace: one question, from the start of the graph to its answer. */
export type RootRun = {
  traceId: string;
  startedAt: string;
  latencyMs: number;
  status: string;
  env: string | undefined;
  /** The drafting model (the `model` label). */
  model: string | undefined;
  promptVersion: string | undefined;
};

export type Query = {
  traceId: string;
  startedAt: string;
  latencyMs: number;
  model: string | undefined;
  calls: number;
  tokens: TokenUsage;
  costUsd: number;
  costByNode: Record<string, number>;
  costByType: { input: number; cacheRead: number; cacheWrite: number; output: number };
  langsmithCostUsd: number;
};

/** The tokens of a call by price. LangChain's input count includes the cached tokens. */
export function tokensOf(call: LlmCall): TokenUsage {
  return {
    input: Math.max(0, call.promptTokens - call.cacheRead - call.cacheWrite),
    cacheRead: call.cacheRead,
    cacheWrite: call.cacheWrite,
    output: call.completionTokens,
  };
}

const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
});

const zero: TokenUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

export type Skipped = { notSuccessful: number; noCalls: number; unknownModel: number };

/**
 * Joins the model calls to their traces and prices them. A trace that failed, that has no model
 * call, or that has a call to a model with no price is left out and counted.
 */
export function buildQueries(
  roots: RootRun[],
  calls: LlmCall[],
): { queries: Query[]; skipped: Skipped } {
  const byTrace = new Map<string, LlmCall[]>();
  for (const call of calls) byTrace.set(call.traceId, [...(byTrace.get(call.traceId) ?? []), call]);

  const skipped: Skipped = { notSuccessful: 0, noCalls: 0, unknownModel: 0 };
  const queries: Query[] = [];
  for (const root of roots) {
    if (root.status !== "success") {
      skipped.notSuccessful++;
      continue;
    }
    const own = byTrace.get(root.traceId) ?? [];
    if (own.length === 0) {
      skipped.noCalls++;
      continue;
    }
    if (own.some((c) => !isModelId(c.model))) {
      skipped.unknownModel++;
      continue;
    }

    let tokens = zero;
    let cost = 0;
    let langsmithCost = 0;
    const costByNode: Record<string, number> = {};
    const costByType = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    for (const call of own) {
      const modelId = call.model as ModelId;
      const t = tokensOf(call);
      const c = usageCostUsd(modelId, t);
      tokens = add(tokens, t);
      cost += c;
      langsmithCost += call.langsmithCostUsd ?? 0;
      const node = call.node ?? "unknown";
      costByNode[node] = (costByNode[node] ?? 0) + c;
      costByType.input += usageCostUsd(modelId, { ...zero, input: t.input });
      costByType.cacheRead += usageCostUsd(modelId, { ...zero, cacheRead: t.cacheRead });
      costByType.cacheWrite += usageCostUsd(modelId, { ...zero, cacheWrite: t.cacheWrite });
      costByType.output += usageCostUsd(modelId, { ...zero, output: t.output });
    }
    queries.push({
      traceId: root.traceId,
      startedAt: root.startedAt,
      latencyMs: root.latencyMs,
      model: root.model,
      calls: own.length,
      tokens,
      costUsd: cost,
      costByNode,
      costByType,
      langsmithCostUsd: langsmithCost,
    });
  }
  return { queries, skipped };
}

const stats = (values: number[]) => ({
  mean: mean(values),
  p50: percentile(values, 50),
  p95: percentile(values, 95),
});

export type Summary = ReturnType<typeof summarize>;

/** The averages, the p50 and p95, and where the money and the tokens go. */
export function summarize(queries: Query[]) {
  if (queries.length === 0) throw new Error("no query to summarize");
  const sum = (pick: (q: Query) => number) => queries.reduce((t, q) => t + pick(q), 0);
  const totalCost = sum((q) => q.costUsd);
  const share = (part: number) => (totalCost === 0 ? 0 : part / totalCost);
  const nodes = [...new Set(queries.flatMap((q) => Object.keys(q.costByNode)))].sort();
  const promptTokens = sum((q) => q.tokens.input + q.tokens.cacheRead + q.tokens.cacheWrite);

  return {
    queries: queries.length,
    totalCostUsd: totalCost,
    costUsd: stats(queries.map((q) => q.costUsd)),
    latencyMs: stats(queries.map((q) => q.latencyMs)),
    modelCalls: mean(queries.map((q) => q.calls)),
    tokens: {
      input: mean(queries.map((q) => q.tokens.input)),
      cacheRead: mean(queries.map((q) => q.tokens.cacheRead)),
      cacheWrite: mean(queries.map((q) => q.tokens.cacheWrite)),
      output: mean(queries.map((q) => q.tokens.output)),
    },
    /** Share of the money by kind of token, over all the queries. */
    costShareByType: {
      input: share(sum((q) => q.costByType.input)),
      cacheRead: share(sum((q) => q.costByType.cacheRead)),
      cacheWrite: share(sum((q) => q.costByType.cacheWrite)),
      output: share(sum((q) => q.costByType.output)),
    },
    /** Share of the money by graph node ("agent" drafts, "reflect" checks). */
    costShareByNode: Object.fromEntries(
      nodes.map((n) => [n, share(sum((q) => q.costByNode[n] ?? 0))]),
    ),
    /** The share of all input tokens that were read from the cache. */
    cacheHitRate: promptTokens === 0 ? 0 : sum((q) => q.tokens.cacheRead) / promptTokens,
    langsmithCostUsd: sum((q) => q.langsmithCostUsd),
  };
}

/** The monthly cost of a number of active authors, at a given use. Costs per query in USD. */
export function projectMonthly(
  costPerQueryUsd: number,
  queriesPerAuthorPerDay: number,
  authors: number,
  daysPerMonth = 30,
): number {
  return costPerQueryUsd * queriesPerAuthorPerDay * daysPerMonth * authors;
}
