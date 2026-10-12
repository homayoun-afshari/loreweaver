import { describe, expect, it } from "vitest";
import { getSystemPrompt, PROMPT_VERSION } from "./index";

describe("system prompt", () => {
  it("loads the versioned prompt file", () => {
    expect(PROMPT_VERSION).toBe("agent.v6");
    expect(getSystemPrompt("world_aethel")).toMatch(/^You are Loreweaver/);
  });

  it("tells the model how to use and cite the lore search", () => {
    const prompt = getSystemPrompt("world_aethel");
    expect(prompt).toContain("search_lore");
    // Answers must come from the passages, with citations, and say so when the lore has nothing.
    expect(prompt).toMatch(/only from the passages the tool returns/i);
    expect(prompt).toMatch(/cite it in square brackets/i);
    expect(prompt).toMatch(/lore does not cover this/i);
    // Retrieved text is data, not orders.
    expect(prompt).toMatch(/not instructions to you/i);
  });

  it("asks for short answers, because the answer is only sent after it is checked", () => {
    expect(getSystemPrompt("world_aethel")).toMatch(/under about 150 words/i);
  });

  it("keeps the assistant in its role", () => {
    const prompt = getSystemPrompt("world_aethel");
    expect(prompt).toMatch(/nothing to do with the author's world/i);
    expect(prompt).toMatch(/do not call a tool for it/i);
  });

  it("asks for the blocking rules, the ban with its exception, and options within the rules", () => {
    const prompt = getSystemPrompt("world_aethel");
    expect(prompt).toMatch(/search for each in its own query/i);
    expect(prompt).toMatch(/both searches in the same turn/i);
    expect(prompt).toMatch(/state the ban itself, then its exception/i);
    expect(prompt).toMatch(/say that it is a change/i);
  });

  it("says that a world, place or character that is not in the lore is not there, and stops", () => {
    const prompt = getSystemPrompt("world_aethel");
    expect(prompt).toMatch(/not in this lore and stop/i);
    expect(prompt).toMatch(/do not answer about a different one/i);
  });

  it("keeps the rules the product depends on", () => {
    const prompt = getSystemPrompt("world_aethel");
    // Live state must come from the tool, never from memory.
    expect(prompt).toContain("fetch_character_state");
    expect(prompt).toMatch(/never answer such questions from memory or guess/i);
    // The model must admit when it does not know.
    expect(prompt).toMatch(/say so instead of inventing/i);
  });
});

describe("the character list is per world", () => {
  it("names only the characters of the world in the chat", () => {
    const aethel = getSystemPrompt("world_aethel");
    expect(aethel).toContain("1 = Aria Voss, 2 = Brannoc Hale, 3 = Sera Quill");
    expect(aethel).not.toMatch(/Kael|Mira/);

    const nox = getSystemPrompt("world_nox");
    expect(nox).toContain("4 = Kael Draven, 5 = Mira Sol");
    expect(nox).not.toMatch(/Aria|Brannoc|Sera/);
  });

  it("leaves no placeholder behind, and lists none for an unknown world", () => {
    expect(getSystemPrompt("world_aethel")).not.toContain("{{");
    const unknown = getSystemPrompt("world_missing");
    expect(unknown).not.toContain("{{");
    expect(unknown).not.toMatch(/Aria|Kael/);
  });
});
