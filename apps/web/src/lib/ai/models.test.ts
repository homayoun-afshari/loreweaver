import { describe, expect, it } from "vitest";
import { costUsd, DEFAULT_MODEL_ID, resolveModelId } from "./models";

describe("resolveModelId", () => {
  it("uses the default when nothing is requested", () => {
    expect(resolveModelId(undefined, undefined)).toBe(DEFAULT_MODEL_ID);
  });

  it("allows an allowlisted model outside production", () => {
    expect(resolveModelId("claude-sonnet-5-5", undefined)).toBe("claude-sonnet-5-5");
    expect(resolveModelId("claude-sonnet-5-5", "preview")).toBe("claude-sonnet-5-5");
  });

  it("ignores a model that is not on the allowlist", () => {
    expect(resolveModelId("gpt-nonexistent", undefined)).toBe(DEFAULT_MODEL_ID);
    expect(resolveModelId("toString", undefined)).toBe(DEFAULT_MODEL_ID);
  });

  it("never lets a caller choose the model in production", () => {
    expect(resolveModelId("claude-sonnet-5-5", "production")).toBe(DEFAULT_MODEL_ID);
  });
});

describe("costUsd", () => {
  it("prices input and output tokens separately", () => {
    // Haiku: $1 in, $5 out per million tokens.
    expect(costUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6);
    expect(costUsd("claude-haiku-4-5", 1000, 500)).toBeCloseTo(0.0035);
  });
});
