import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoreHit } from "@/lib/rag/search-types";
import {
  LoreCitationCards,
  LoreCitationCardsError,
  LoreCitationCardsSkeleton,
} from "./lore-citation-cards";

const hit: LoreHit = {
  citationId: "3fa9c1d2",
  sourcePath: "data/lore/world_aethel/magic-system.md",
  headingPath: "The Magic of Aethel > Casting Rules > Teleportation",
  docType: "rule",
  content:
    "Teleportation costs 50 mana and cannot cross warded walls.\n\nThe caster arrives at once.",
  similarity: 0.71,
};

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("LoreCitationCards", () => {
  it("shows, for each hit, the heading, the file, the kind, the id and a snippet", () => {
    const out = html(
      createElement(LoreCitationCards, { hits: [hit, { ...hit, citationId: "aaaaaaaa" }] }),
    );
    expect(out).toContain("2 sources from your lore");
    expect(out).toContain("The Magic of Aethel &gt; Casting Rules &gt; Teleportation");
    expect(out).toContain("magic-system.md");
    expect(out).toContain("Rule");
    expect(out).toContain("3fa9c1d2");
    expect(out).toContain("aaaaaaaa");
    // The snippet is on one line, and the full text is in the part that opens.
    expect(out).toContain(
      "Teleportation costs 50 mana and cannot cross warded walls. The caster arrives at once.",
    );
  });

  it("is collapsed by default (a native details element, not open)", () => {
    const out = html(createElement(LoreCitationCards, { hits: [hit] }));
    expect(out).toContain("<details");
    expect(out).not.toMatch(/<details[^>]* open/);
    expect(out).toContain("<summary");
  });

  it("escapes passage text instead of treating it as HTML", () => {
    const out = html(
      createElement(LoreCitationCards, {
        hits: [{ ...hit, content: "<img src=x onerror=alert(1)>" }],
      }),
    );
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("says so when nothing matched", () => {
    const out = html(createElement(LoreCitationCards, { hits: [] }));
    expect(out).toContain("No matching lore");
    expect(out).not.toContain("<details");
  });
});

describe("loading and error states", () => {
  it("draws a skeleton that announces itself as a status", () => {
    const out = html(createElement(LoreCitationCardsSkeleton));
    expect(out).toContain('role="status"');
    expect(out).toContain("Searching your lore");
  });

  it("draws an error card as an alert", () => {
    const out = html(createElement(LoreCitationCardsError));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Lore search unavailable");
  });
});
