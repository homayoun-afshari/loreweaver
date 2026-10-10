import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHUNK_CONFIGS } from "../apps/web/src/lib/rag/chunking";
import { loadLoreFiles } from "../apps/web/src/lib/rag/lore-files";
import {
  corpusSectionKeys,
  findBrokenLabels,
  parseDataset,
  relevantGrades,
  sourcePathOf,
} from "./retrieval-dataset";

const line = (o: object) => JSON.stringify(o);
const good = {
  id: "q01",
  world: "w",
  query: "Q?",
  tags: ["rule"],
  relevant: [{ file: "a.md", heading: "A > B", grade: 2 }],
};

describe("parseDataset", () => {
  it("reads one query per line, ignoring blank lines", () => {
    const cases = parseDataset(`${line(good)}\n\n${line({ ...good, id: "q02" })}\n`);
    expect(cases.map((c) => c.id)).toEqual(["q01", "q02"]);
  });

  it("names the line of every problem", () => {
    const text = [line(good), "{not json", line({ ...good, id: "q03", tags: ["nonsense"] })].join(
      "\n",
    );
    expect(() => parseDataset(text)).toThrow(/line 2: not valid JSON/);
    expect(() => parseDataset(text)).toThrow(/line 3: .*tags/);
  });

  it("rejects an unknown field, a bad grade and a bad id", () => {
    expect(() => parseDataset(line({ ...good, extra: 1 }))).toThrow(/line 1/);
    expect(() =>
      parseDataset(line({ ...good, relevant: [{ file: "a.md", heading: "H", grade: 5 }] })),
    ).toThrow(/grade/);
    expect(() => parseDataset(line({ ...good, id: "one" }))).toThrow(/q01/);
  });

  it("keeps the tag 'negative' and the absence of labels in step", () => {
    expect(() => parseDataset(line({ ...good, tags: ["negative"] }))).toThrow(/negative/);
    expect(() => parseDataset(line({ ...good, relevant: [] }))).toThrow(/negative/);
    expect(parseDataset(line({ ...good, tags: ["negative"], relevant: [] }))).toHaveLength(1);
  });

  it("rejects a repeated id and a section labeled twice", () => {
    expect(() => parseDataset(`${line(good)}\n${line(good)}`)).toThrow(
      /q01 is used more than once/,
    );
    const twice = { ...good, relevant: [good.relevant[0], good.relevant[0]] };
    expect(() => parseDataset(line(twice))).toThrow(/labeled twice/);
  });
});

describe("labels", () => {
  it("keys a query's relevant sections by their place in the repository", () => {
    const [c] = parseDataset(line(good));
    expect(sourcePathOf("w", "a.md")).toBe("data/lore/w/a.md");
    expect([...relevantGrades(c)]).toEqual([["data/lore/w/a.md|A > B", 2]]);
  });

  it("finds a label whose section does not exist", () => {
    const [c] = parseDataset(line(good));
    expect(findBrokenLabels([c], new Set(["data/lore/w/a.md|A > B"]))).toEqual([]);
    expect(findBrokenLabels([c], new Set())).toEqual([
      'q01: no section "A > B" in data/lore/w/a.md',
    ]);
  });
});

describe("the real eval set (evals/retrieval.jsonl) against the real Lore Bible", () => {
  const datasetPath = fileURLToPath(new URL("./retrieval.jsonl", import.meta.url));
  const loreRoot = fileURLToPath(new URL("../data/lore/", import.meta.url));

  it("is valid, with at least 20 queries, and covers both worlds", async () => {
    const cases = parseDataset(await readFile(datasetPath, "utf8"));
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.world))).toEqual(new Set(["world_aethel", "world_nox"]));
    expect(cases.some((c) => c.tags.includes("negative"))).toBe(true);
  });

  it("only labels sections that exist, so a typo or an edit of the lore cannot go unnoticed", async () => {
    const cases = parseDataset(await readFile(datasetPath, "utf8"));
    const corpus = corpusSectionKeys(await loadLoreFiles(loreRoot), CHUNK_CONFIGS["heading-800"]);
    expect(findBrokenLabels(cases, corpus)).toEqual([]);
  });

  it("labels each query only with sections of its own world", async () => {
    // A label is looked up in data/lore/<world>/, so a label for another world's file cannot exist.
    const cases = parseDataset(await readFile(datasetPath, "utf8"));
    const corpus = corpusSectionKeys(await loadLoreFiles(loreRoot), CHUNK_CONFIGS["heading-800"]);
    for (const c of cases) {
      for (const key of relevantGrades(c).keys()) {
        expect(key.startsWith(`data/lore/${c.world}/`)).toBe(true);
        expect(corpus.has(key)).toBe(true);
      }
    }
  });
});
