import { describe, expect, it } from "vitest";
import { AGENT_MODEL_ID, costUsd, DEV_MODEL_ID, resolveModelId } from "./models";

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

describe("costUsd", () => {
  it("prices input and output tokens separately", () => {
    // Haiku: $1 in, $5 out per million tokens.
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6);
    expect(costUsd("claude-haiku-4-5", 1000, 500)).toBeCloseTo(0.0035);
  });
});
