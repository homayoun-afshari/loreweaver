import { Client } from "langsmith";
import type { LlmCall, RootRun } from "./cost-metrics";

/**
 * Reads the traces of the agent back from LangSmith, for the cost report (evals/cost-report.ts).
 * Tooling only: the app itself never reads traces. The mapping is split from the network calls so
 * it can be tested with runs copied from real traces.
 */

/** The fields of a run that the report reads (the SDK types a run's fields loosely). */
export type ApiRun = {
  id?: string;
  trace_id?: string;
  start_time?: string;
  latency_seconds?: number;
  status?: string;
  metadata?: Record<string, unknown>;
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_token_details?: { raw?: Record<string, unknown> };
  total_cost?: number;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A root run of a trace: the labels (`env`, `model`, `prompt_version`) are its metadata. */
export function toRootRun(run: ApiRun): RootRun {
  const meta = run.metadata ?? {};
  return {
    traceId: String(run.trace_id ?? run.id),
    startedAt: String(run.start_time ?? ""),
    latencyMs: num(run.latency_seconds) * 1000,
    status: String(run.status ?? ""),
    env: text(meta.env),
    model: text(meta.model),
    promptVersion: text(meta.prompt_version),
  };
}

/**
 * One model call. `ls_model_name` is the model that was really called (the `model` label is the
 * drafting model and also sits on the checker's calls), and `langgraph_node` the node that made it.
 * LangSmith's `prompt_tokens` includes the cached tokens, which it lists apart.
 */
export function toLlmCall(run: ApiRun): LlmCall {
  const meta = run.metadata ?? {};
  const cache = run.prompt_token_details?.raw ?? {};
  return {
    traceId: String(run.trace_id),
    model: text(meta.ls_model_name),
    node: text(meta.langgraph_node),
    promptTokens: num(run.prompt_tokens),
    completionTokens: num(run.completion_tokens),
    cacheRead: num(cache.cache_read),
    cacheWrite: num(cache.cache_creation),
    langsmithCostUsd: typeof run.total_cost === "number" ? run.total_cost : undefined,
  };
}

async function collect(page: AsyncIterable<unknown>): Promise<ApiRun[]> {
  const items: ApiRun[] = [];
  for await (const item of page) items.push(item as ApiRun);
  return items;
}

/**
 * The root runs of a project between two moments, and every model call of the same period. The client
 * reads LANGSMITH_API_KEY, LANGSMITH_ENDPOINT and LANGSMITH_WORKSPACE_ID from the environment.
 */
export async function fetchTraceRuns(args: {
  projectName: string;
  since: Date;
  /** The end of the period; now when omitted. */
  until?: Date;
}): Promise<{ roots: RootRun[]; calls: LlmCall[] }> {
  const client = new Client();
  const project = await client.readProject({ projectName: args.projectName });
  const window = {
    project_ids: [project.id],
    min_start_time: args.since.toISOString(),
    ...(args.until && { max_start_time: args.until.toISOString() }),
  };
  const roots = await collect(
    client.runs.queryV2({
      ...window,
      is_root: true,
      selects: ["ID", "TRACE_ID", "START_TIME", "LATENCY_SECONDS", "STATUS", "METADATA"],
    }),
  );
  const calls = await collect(
    client.runs.queryV2({
      ...window,
      run_type: "LLM",
      selects: [
        "ID",
        "TRACE_ID",
        "STATUS",
        "PROMPT_TOKENS",
        "COMPLETION_TOKENS",
        "PROMPT_TOKEN_DETAILS",
        "TOTAL_COST",
        "METADATA",
      ],
    }),
  );
  return { roots: roots.map(toRootRun), calls: calls.map(toLlmCall) };
}
