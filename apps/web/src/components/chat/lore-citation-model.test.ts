import { describe, expect, it } from "vitest";
import {
  describeSearchError,
  docTypeLabel,
  fileName,
  SNIPPET_MAX_CHARS,
  snippet,
  sourcesSummary,
} from "./lore-citation-model";

describe("fileName", () => {
  it("keeps only the last part of the path", () => {
    expect(fileName("data/lore/world_aethel/magic-system.md")).toBe("magic-system.md");
    expect(fileName("magic-system.md")).toBe("magic-system.md");
  });
});

describe("snippet", () => {
  it("returns a short passage unchanged, on one line", () => {
    expect(snippet("Teleportation costs 50 mana.\n\nIt cannot cross wards.")).toBe(
      "Teleportation costs 50 mana. It cannot cross wards.",
    );
  });

  it("cuts a long passage at a word and adds an ellipsis", () => {
    const long = "word ".repeat(100);
    const result = snippet(long);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 1);
    expect(result.slice(0, -1).endsWith("word")).toBe(true); // not cut inside a word
  });

  it("copes with one huge word", () => {
    expect(snippet("x".repeat(500)).length).toBe(SNIPPET_MAX_CHARS + 1);
  });
});

describe("labels", () => {
  it("names the kinds of document", () => {
    expect(docTypeLabel("rule")).toBe("Rule");
    expect(docTypeLabel("character")).toBe("Character");
  });

  it("counts the sources", () => {
    expect(sourcesSummary(1)).toBe("1 source from your lore");
    expect(sourcesSummary(3)).toBe("3 sources from your lore");
  });

  it("describes a search failure without internal details", () => {
    const { title, detail } = describeSearchError();
    expect(title).toMatch(/unavailable/i);
    expect(detail).not.toMatch(/http|sql|postgres|voyage/i);
  });
});
