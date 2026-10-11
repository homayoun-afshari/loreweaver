import { describe, expect, it } from "vitest";
import { type ChunkConfig } from "./chunking";
import {
  buildDesiredChunks,
  type DesiredChunk,
  type ExistingChunk,
  hashForEmbedding,
  planIngest,
  withEmbeddings,
} from "./ingest-plan";
import type { LoreFile } from "./lore-files";

const config: ChunkConfig = { maxTokens: 800, overlapTokens: 80, embedHeadings: true };

const file = (
  markdown: string,
  name = "a.md",
  docType: LoreFile["docType"] = "rule",
): LoreFile => ({
  worldId: "world_a",
  sourcePath: `data/lore/world_a/${name}`,
  docType,
  markdown,
});

const build = (files: LoreFile[], model = "model-1") =>
  buildDesiredChunks(files, "heading-800", config, model);

/** What the database would hold after a run that stored all of `chunks`. */
const stored = (chunks: DesiredChunk[]): ExistingChunk[] =>
  chunks.map((c) => ({
    sourcePath: c.sourcePath,
    chunkIndex: c.chunkIndex,
    docType: c.docType,
    headingPath: c.headingPath,
    contentHash: c.contentHash,
    embedding: [c.chunkIndex],
  }));

const base = file(
  "# T\n\n## One\n\nFirst text.\n\n## Two\n\nSecond text.\n\n## Three\n\nThird text.",
);

describe("buildDesiredChunks", () => {
  it("numbers the chunks of each file from 0, with labels, hashes and sizes", () => {
    const chunks = build([base, file("# U\n\nOther.", "b.md", "history")]);
    expect(chunks.map((c) => [c.sourcePath.split("/").pop(), c.chunkIndex])).toEqual([
      ["a.md", 0],
      ["a.md", 1],
      ["a.md", 2],
      ["b.md", 0],
    ]);
    expect(chunks[3]).toMatchObject({ docType: "history", headingPath: "U", worldId: "world_a" });
    expect(chunks[0].embeddedText).toBe("T > One\n\nFirst text.");
    expect(chunks[0].contentHash).toBe(hashForEmbedding("model-1", chunks[0].embeddedText));
  });
});

describe("planIngest", () => {
  it("embeds everything on the first run", () => {
    const plan = planIngest(build([base]), []);
    expect(plan.embed).toHaveLength(3);
    expect(plan.keep).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it("is idempotent: a second run on unchanged files embeds and writes nothing", () => {
    const desired = build([base]);
    const plan = planIngest(desired, stored(desired));
    expect(plan.keep).toHaveLength(3);
    expect(plan.embed).toHaveLength(0);
    expect(plan.copy).toHaveLength(0);
    expect(plan.write).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it("embeds only the chunk whose text changed", () => {
    const before = build([base]);
    const edited = file(base.markdown.replace("Second text.", "Second text, now longer."));
    const plan = planIngest(build([edited]), stored(before));
    expect(plan.embed.map((c) => c.headingPath)).toEqual(["T > Two"]);
    expect(plan.keep).toHaveLength(2);
    expect(plan.write).toHaveLength(1);
  });

  it("re-embeds everything when the embedding model changes", () => {
    const before = build([base], "model-1");
    const plan = planIngest(build([base], "model-2"), stored(before));
    expect(plan.embed).toHaveLength(3);
    expect(plan.keep).toHaveLength(0);
  });

  it("reuses a stored vector when a chunk only moves (no API call)", () => {
    const before = build([base]);
    const withNewFirstSection = file(
      base.markdown.replace("## One", "## Zero\n\nNew text.\n\n## One"),
    );
    const plan = planIngest(build([withNewFirstSection]), stored(before));
    expect(plan.embed.map((c) => c.headingPath)).toEqual(["T > Zero"]);
    // "One", "Two" and "Three" all moved one place down: their vectors are copied, not paid for again.
    expect(plan.copy).toHaveLength(3);
    expect(plan.remove).toHaveLength(0);
  });

  it("removes stored chunks whose place no longer exists", () => {
    const before = build([base, file("# U\n\nOther.", "b.md")]);
    const plan = planIngest(build([base]), stored(before));
    expect(plan.remove).toEqual([{ sourcePath: "data/lore/world_a/b.md", chunkIndex: 0 }]);
    expect(plan.keep).toHaveLength(3);
  });

  it("rewrites the labels of a chunk without paying for a new vector", () => {
    const before = build([base]);
    const relabeled = file(base.markdown, "a.md", "history");
    const plan = planIngest(build([relabeled]), stored(before));
    expect(plan.embed).toHaveLength(0);
    expect(plan.write).toHaveLength(3);
    expect(plan.copy).toHaveLength(3);
  });

  it("pays once for identical text that appears twice", () => {
    const twice = file("# T\n\n## One\n\nSame.\n\n## One\n\nSame.");
    const plan = planIngest(build([twice]), []);
    expect(plan.write).toHaveLength(2);
    expect(plan.embed).toHaveLength(1);
  });
});

describe("withEmbeddings", () => {
  it("pairs every chunk to write with a vector, from storage or from the new embeddings", () => {
    const before = build([base]);
    const edited = file(
      base.markdown
        .replace("Second text.", "Changed.")
        .replace("## One", "## Zero\n\nNew.\n\n## One"),
    );
    const plan = planIngest(build([edited]), stored(before));
    const embedded = plan.embed.map((chunk) => ({ chunk, embedding: [99] }));
    const rows = withEmbeddings(plan, embedded);
    expect(rows).toHaveLength(plan.write.length);
    expect(rows.every((r) => r.embedding.length === 1)).toBe(true);
  });

  it("fails loudly if a vector is missing", () => {
    const plan = planIngest(build([base]), []);
    expect(() => withEmbeddings(plan, [])).toThrow(/No vector/);
  });
});
