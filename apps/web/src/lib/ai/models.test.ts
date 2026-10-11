import { describe, expect, it } from "vitest";
import { AGENT_MODEL_ID, costUsd, DEV_MODEL_ID, resolveModelId, usageCostUsd } from "./models";

describe("resolveModelId", () => {
  it("uses the cheap model on a developer's machine when nothing is requested", () => {
    expect(resolveModelId(undefined, undefined)).toBe(DEV_MODEL_ID);
    expect(resolveModelId(undefined, "development")).toBe(DEV_MODEL_ID);
  });

  it("uses the agent model in Preview and Production", () => {
    expect(resolveModelId(undefined, "preview")).toBe(AGENT_MODEL_ID);
    expect(resolveModelId(undefined, "production")).toBe(AGENT_MODEL_ID);
  });

  it("allows an allowlisted model locally", () => {
    expect(resolveModelId("claude-sonnet-5-5", undefined)).toBe("claude-sonnet-5-5");
  });

  it("ignores a model that is not on the allowlist", () => {
    expect(resolveModelId("gpt-nonexistent", undefined)).toBe(DEV_MODEL_ID);
    expect(resolveModelId("toString", undefined)).toBe(DEV_MODEL_ID);
  });

  it("never lets a caller choose the model in Preview or Production", () => {
    expect(resolveModelId("claude-haiku-4-5", "production")).toBe(AGENT_MODEL_ID);
    expect(resolveModelId("claude-haiku-4-5", "preview")).toBe(AGENT_MODEL_ID);
  });
});

describe("usageCostUsd", () => {
  it("prices every kind of token separately", () => {
    // Sonnet: $2 in, $0.10 cache read, $2.50 cache write, $10 out per million tokens.
    const million = { input: 1e6, cacheRead: 1e6, cacheWrite: 1e6, output: 1e6 };
    expect(usageCostUsd("claude-sonnet-5-5", million)).toBeCloseTo(2 + 0.1 + 2.5 + 10);
    // Haiku: $1 in, $0.10 cache read, $1.25 cache write, $5 out.
    expect(usageCostUsd("claude-haiku-4-5", million)).toBeCloseTo(1 + 0.1 + 1.25 + 5);
  });

  it("agrees with costUsd when nothing is cached", () => {
    const usage = { input: 2114, cacheRead: 0, cacheWrite: 0, output: 32 };
    expect(usageCostUsd("claude-sonnet-5-5", usage)).toBeCloseTo(
      costUsd("claude-sonnet-5-5", 2114, 32),
    );
    // The same call, as LangSmith priced it in a real trace.
    expect(usageCostUsd("claude-sonnet-5-5", usage)).toBeCloseTo(0.004548, 6);
  });

  it("makes a cache read cheaper than normal input", () => {
    const read = usageCostUsd("claude-sonnet-5-5", {
      input: 0,
      cacheRead: 1000,
      cacheWrite: 0,
      output: 0,
    });
    const plain = usageCostUsd("claude-sonnet-5-5", {
      input: 1000,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
    });
    expect(read).toBeLessThan(plain);
  });
});

describe("costUsd", () => {
  it("prices input and output tokens separately", () => {
    // Haiku: $1 in, $5 out per million tokens.
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6);
    expect(costUsd("claude-haiku-4-5", 1000, 500)).toBeCloseTo(0.0035);
  });
});
