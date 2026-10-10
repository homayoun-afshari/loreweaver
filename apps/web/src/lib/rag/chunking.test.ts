import { describe, expect, it } from "vitest";
import {
  CHUNK_CONFIGS,
  type ChunkConfig,
  chunkMarkdown,
  estimateTokens,
  textToEmbed,
} from "./chunking";

// A tiny cap (10 tokens = 40 characters) so that short test texts have to be split.
const small: ChunkConfig = { maxTokens: 10, overlapTokens: 2, embedHeadings: true };
const big: ChunkConfig = { maxTokens: 800, overlapTokens: 80, embedHeadings: true };

describe("heading paths", () => {
  const markdown = [
    "# Magic",
    "Intro text.",
    "## Casting",
    "### Teleportation",
    "Costs 50 mana.",
    "### Healing",
    "Costs 25 mana.",
    "## Mana",
    "Regenerates slowly.",
  ].join("\n\n");

  it("keeps the headings above a chunk, and resets them at the next sibling", () => {
    const chunks = chunkMarkdown(markdown, big);
    expect(chunks.map((c) => c.headingPath)).toEqual([
      "Magic",
      "Magic > Casting > Teleportation",
      "Magic > Casting > Healing",
      "Magic > Mana",
    ]);
  });

  it("gives text before the first heading an empty path", () => {
    const chunks = chunkMarkdown("Loose text.\n\n# Title\n\nBody.", big);
    expect(chunks[0]).toEqual({ headingPath: "", content: "Loose text." });
    expect(chunks[1].headingPath).toBe("Title");
  });

  it("makes no chunk for a heading that is directly followed by another heading", () => {
    const chunks = chunkMarkdown("# A\n\n## B\n\nText.", big);
    expect(chunks).toEqual([{ headingPath: "A > B", content: "Text." }]);
  });

  it("does not mistake a '#' line inside a code block for a heading", () => {
    const chunks = chunkMarkdown("# Title\n\n```sh\n# a comment\n```\n\nAfter.", big);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("# a comment");
  });

  it("handles a heading level that jumps (a '###' directly under a '#')", () => {
    const chunks = chunkMarkdown("# A\n\n### Deep\n\nText.", big);
    expect(chunks[0].headingPath).toBe("A > Deep");
  });
});

describe("size cap", () => {
  const paragraph = "One short sentence here. Another short sentence follows. A third one ends it.";
  const markdown = `# Title\n\n${paragraph}\n\n${paragraph}`;

  it("keeps a section that fits as one chunk, with its exact text", () => {
    expect(chunkMarkdown("# T\n\nFits easily.", small)).toEqual([
      { headingPath: "T", content: "Fits easily." },
    ]);
  });

  it("never makes a chunk larger than the cap", () => {
    const chunks = chunkMarkdown(markdown, small);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(small.maxTokens * 4);
    }
  });

  it("loses no sentence when it splits", () => {
    const joined = chunkMarkdown(markdown, small)
      .map((c) => c.content)
      .join(" ");
    for (const sentence of [
      "One short sentence here.",
      "Another short sentence follows.",
      "A third one ends it.",
    ]) {
      expect(joined).toContain(sentence);
    }
  });

  it("repeats the end of one chunk at the start of the next (overlap)", () => {
    const chunks = chunkMarkdown(markdown, small);
    const [first, second] = chunks;
    const lastWord = first.content.split(" ").at(-1)!;
    expect(second.content.startsWith(lastWord) || second.content.includes(lastWord)).toBe(true);
    expect(second.content.length).toBeGreaterThan(0);
  });

  it("does not overlap across headings", () => {
    const chunks = chunkMarkdown("# A\n\nAlpha text.\n\n# B\n\nBeta text.", small);
    expect(chunks.map((c) => c.content)).toEqual(["Alpha text.", "Beta text."]);
  });

  it("splits a word run that has no sentence end, and keeps a very long word whole", () => {
    const longWord = "x".repeat(100);
    const chunks = chunkMarkdown(
      `# T\n\nalpha beta gamma delta epsilon zeta eta theta ${longWord}`,
      small,
    );
    expect(chunks.some((c) => c.content.includes(longWord))).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("textToEmbed", () => {
  const chunk = { headingPath: "A > B", content: "Text." };

  it("puts the heading path in front when asked", () => {
    expect(textToEmbed(chunk, big)).toBe("A > B\n\nText.");
  });

  it("uses the content alone when headings are off, or there is no heading", () => {
    expect(textToEmbed(chunk, { ...big, embedHeadings: false })).toBe("Text.");
    expect(textToEmbed({ headingPath: "", content: "Text." }, big)).toBe("Text.");
  });
});

describe("estimateTokens and the named configurations", () => {
  it("estimates four characters per token, rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("has an overlap smaller than the cap in every configuration", () => {
    for (const config of Object.values(CHUNK_CONFIGS)) {
      expect(config.overlapTokens).toBeLessThan(config.maxTokens);
    }
  });
});
