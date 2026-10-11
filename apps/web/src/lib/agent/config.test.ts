import { describe, expect, it } from "vitest";
import { agentRunConfig, traceEnv } from "./config";

describe("traceEnv", () => {
  it("names the cloud environments and calls everything else development", () => {
    expect(traceEnv("production")).toBe("production");
    expect(traceEnv("preview")).toBe("preview");
    expect(traceEnv("development")).toBe("development");
    expect(traceEnv(undefined)).toBe("development");
  });
});

describe("agentRunConfig", () => {
  it("carries the world and the start time, and no labels by default", () => {
    expect(agentRunConfig("world_aethel", 1000)).toEqual({
      configurable: { worldId: "world_aethel", startedAt: 1000 },
    });
  });

  it("adds the three trace labels as metadata", () => {
    const config = agentRunConfig("world_aethel", 1000, {
      promptVersion: "agent.v3",
      modelId: "claude-haiku-4-5",
      vercelEnv: undefined,
    });
    expect(config.metadata).toEqual({
      prompt_version: "agent.v3",
      model: "claude-haiku-4-5",
      env: "development",
    });
  });
});
