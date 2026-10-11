import { describe, expect, it } from "vitest";
import { toLlmCall, toRootRun } from "./langsmith-runs";

// Shaped like the runs LangSmith returned for a real trace of the agent.
const checkerCall = {
  id: "r1",
  trace_id: "t1",
  status: "success",
  prompt_tokens: 1286,
  completion_tokens: 50,
  prompt_token_details: { raw: { cache_creation: 0, cache_read: 0 } },
  total_cost: 0.001536,
  metadata: {
    env: "preview",
    model: "claude-sonnet-5-5",
    prompt_version: "agent.v3",
    langgraph_node: "reflect",
    ls_model_name: "claude-haiku-4-5",
  },
};

describe("toLlmCall", () => {
  it("reads the model that was really called, not the drafting model label", () => {
    const call = toLlmCall(checkerCall);
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.node).toBe("reflect");
    expect(call).toMatchObject({
      traceId: "t1",
      promptTokens: 1286,
      completionTokens: 50,
      cacheRead: 0,
      cacheWrite: 0,
      langsmithCostUsd: 0.001536,
    });
  });

  it("reads the cached tokens", () => {
    const call = toLlmCall({
      ...checkerCall,
      prompt_token_details: { raw: { cache_creation: 300, cache_read: 900 } },
    });
    expect(call.cacheRead).toBe(900);
    expect(call.cacheWrite).toBe(300);
  });

  it("copes with missing fields", () => {
    expect(toLlmCall({ trace_id: "t" })).toMatchObject({
      model: undefined,
      promptTokens: 0,
      cacheRead: 0,
      langsmithCostUsd: undefined,
    });
  });
});

describe("toRootRun", () => {
  it("reads the labels, the status and the latency in milliseconds", () => {
    const root = toRootRun({
      id: "t1",
      trace_id: "t1",
      start_time: "2026-10-11T18:27:55Z",
      latency_seconds: 7.6,
      status: "success",
      metadata: { env: "development", model: "claude-haiku-4-5", prompt_version: "agent.v3" },
    });
    expect(root).toEqual({
      traceId: "t1",
      startedAt: "2026-10-11T18:27:55Z",
      latencyMs: 7600,
      status: "success",
      env: "development",
      model: "claude-haiku-4-5",
      promptVersion: "agent.v3",
    });
  });
});
