import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CITATION_ID_LENGTH,
  DEFAULT_TOP_K,
  MAX_TOP_K,
  MIN_SIMILARITY,
  type NearestRow,
  searchLore,
} from "./search";

const row = (n: number, similarity: number): NearestRow => ({
  id: `${n}`.repeat(8) + "-0000-4000-8000-000000000000",
  sourcePath: "data/lore/world_aethel/magic-system.md",
  headingPath: `Heading ${n}`,
  docType: "rule",
  content: `Passage ${n}.`,
  similarity,
});

function deps(rows: NearestRow[]) {
  return {
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
    findNearest: vi.fn().mockResolvedValue(rows),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("searchLore", () => {
  it("embeds the question, searches the given world, and returns cited passages", async () => {
    const d = deps([row(1, 0.8), row(2, 0.6)]);
    const result = await searchLore({ worldId: "world_nox", query: "  teleport cost " }, d);

    expect(d.embedQuery).toHaveBeenCalledWith("teleport cost"); // trimmed
    expect(d.findNearest).toHaveBeenCalledWith({
      worldId: "world_nox", // exactly the world that was passed in
      chunking: "heading-800",
      embedding: [0.1, 0.2],
      limit: DEFAULT_TOP_K,
    });
    expect(result).toEqual({
      ok: true,
      hits: [
        expect.objectContaining({
          citationId: "11111111",
          headingPath: "Heading 1",
          similarity: 0.8,
        }),
        expect.objectContaining({
          citationId: "22222222",
          headingPath: "Heading 2",
          similarity: 0.6,
        }),
      ],
    });
    expect(CITATION_ID_LENGTH).toBe(8);
  });

  it("returns the top 3 by default and clamps k to the allowed range", async () => {
    for (const [k, limit] of [
      [undefined, DEFAULT_TOP_K],
      [5, 5],
      [0, 1],
      [-3, 1],
      [100, MAX_TOP_K],
      [2.9, 2],
    ] as const) {
      const d = deps([]);
      await searchLore({ worldId: "w", query: "q", k }, d);
      expect(d.findNearest.mock.calls[0][0].limit, `k=${k}`).toBe(limit);
    }
  });

  it("drops passages below the similarity floor, so an uncovered question returns nothing", async () => {
    const d = deps([row(1, MIN_SIMILARITY + 0.01), row(2, MIN_SIMILARITY - 0.01), row(3, 0.1)]);
    const result = await searchLore({ worldId: "w", query: "q" }, d);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.hits.map((h) => h.headingPath)).toEqual(["Heading 1"]);

    const none = await searchLore({ worldId: "w", query: "q" }, deps([row(1, 0.2)]));
    expect(none).toEqual({ ok: true, hits: [] });
  });

  it("reports a failure as data, without leaking the cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps([]);
    d.embedQuery.mockRejectedValue(new Error("HTTP 401 key sk-secret"));
    const result = await searchLore({ worldId: "w", query: "q" }, d);
    expect(result).toEqual({
      ok: false,
      error: { kind: "unavailable", message: "Lore search is unavailable right now." },
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
    expect(d.findNearest).not.toHaveBeenCalled();
  });

  it("reports a database failure as data too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps([]);
    d.findNearest.mockRejectedValue(new Error("connection refused"));
    await expect(searchLore({ worldId: "w", query: "q" }, d)).resolves.toMatchObject({ ok: false });
  });
});
