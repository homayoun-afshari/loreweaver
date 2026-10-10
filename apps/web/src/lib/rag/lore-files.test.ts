import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, CHUNK_CONFIGS } from "./chunking";
import { loadLoreFiles, parseLoreFile } from "./lore-files";

const where = { worldId: "world_test", sourcePath: "data/lore/world_test/x.md" };

describe("parseLoreFile", () => {
  it("reads doc_type and returns the Markdown after the front matter", () => {
    const file = parseLoreFile("---\ndoc_type: rule\n---\n\n# Title\n\nText.\n", where);
    expect(file.docType).toBe("rule");
    expect(file.markdown.trim()).toBe("# Title\n\nText.");
    expect(file.worldId).toBe("world_test");
  });

  it("gives the same result for Windows (CRLF) and Unix (LF) line endings", () => {
    const lf = "---\ndoc_type: location\n---\n\n# T\n\nLine one.\nLine two.\n";
    expect(parseLoreFile(lf.replace(/\n/g, "\r\n"), where)).toEqual(parseLoreFile(lf, where));
  });

  it("rejects a file without front matter, naming the file", () => {
    expect(() => parseLoreFile("# Title\n", where)).toThrow(/x\.md: missing front matter/);
  });

  it("rejects an unknown or missing doc_type", () => {
    expect(() => parseLoreFile("---\ndoc_type: poem\n---\n", where)).toThrow(
      /doc_type must be one of/,
    );
    expect(() => parseLoreFile("---\ntitle: x\n---\n", where)).toThrow(/doc_type must be one of/);
  });
});

describe("the Lore Bible in data/lore", () => {
  const root = fileURLToPath(new URL("../../../../../data/lore/", import.meta.url));

  it("has valid files in both worlds, in a stable order", async () => {
    const files = await loadLoreFiles(root);
    const worlds = [...new Set(files.map((f) => f.worldId))];
    expect(worlds).toEqual(["world_aethel", "world_nox"]);
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.map((f) => f.sourcePath)).toEqual(files.map((f) => f.sourcePath).sort());
  });

  it("starts every file with a title and gives every file at least one chunk", async () => {
    for (const file of await loadLoreFiles(root)) {
      expect(file.markdown.trim().startsWith("# "), file.sourcePath).toBe(true);
      expect(
        chunkMarkdown(file.markdown, CHUNK_CONFIGS["heading-800"]).length,
        file.sourcePath,
      ).toBeGreaterThan(0);
    }
  });

  it("can be limited to one world, and rejects a world that does not exist", async () => {
    const files = await loadLoreFiles(root, ["world_nox"]);
    expect(new Set(files.map((f) => f.worldId))).toEqual(new Set(["world_nox"]));
    await expect(loadLoreFiles(root, ["world_missing"])).rejects.toThrow(/No lore folder/);
  });
});
