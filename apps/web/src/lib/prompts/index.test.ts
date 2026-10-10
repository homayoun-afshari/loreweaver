import { describe, expect, it } from "vitest";
import { getSystemPrompt, PROMPT_VERSION } from "./index";

describe("system prompt", () => {
  it("loads the versioned prompt file", () => {
    expect(PROMPT_VERSION).toBe("agent.v1");
    expect(getSystemPrompt()).toMatch(/^You are Loreweaver/);
  });

  it("keeps the rules the product depends on", () => {
    const prompt = getSystemPrompt();
    // Live state must come from the tool, never from memory.
    expect(prompt).toContain("fetch_character_state");
    expect(prompt).toMatch(/never answer such questions from memory or guess/i);
    // The model must admit when it does not know.
    expect(prompt).toMatch(/say so instead of inventing/i);
  });
});
