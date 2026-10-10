import { describe, expect, it } from "vitest";
import {
  isAbstention,
  meanScore,
  meanScoreByTag,
  scoreRanking,
  sectionKey,
} from "./retrieval-metrics";

// Two relevant sections: A answers the question (grade 2), B is related (grade 1).
const relevant = new Map([
  ["A", 2],
  ["B", 1],
]);

describe("scoreRanking: a worked example, computed by hand", () => {
  // Ranking [X, B, A], k = 3. X is not relevant.
  //   hit       = 1            (a relevant section is in the top 3)
  //   recall    = 2 / 2 = 1    precision = 2 / 3
  //   rr        = 1 / 2        (the first relevant, B, is at rank 2)
  //   DCG       = 0/1 + 1/log2(3) + 2/log2(4) = 0.6309 + 1.0000 = 1.6309
  //   ideal     = 2/1 + 1/log2(3)             = 2.0000 + 0.6309 = 2.6309
  //   nDCG      = 1.6309 / 2.6309 = 0.6199
  const score = scoreRanking(["X", "B", "A"], relevant, 3);

  it("hit, recall, precision and reciprocal rank", () => {
    expect(score.hit).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.precision).toBeCloseTo(2 / 3);
    expect(score.reciprocalRank).toBe(0.5);
  });

  it("nDCG with graded relevance and a position discount", () => {
    expect(score.ndcg).toBeCloseTo(1.6309 / 2.6309, 3);
    expect(score.ndcg).toBeCloseTo(0.62, 2);
  });
});

describe("scoreRanking: other cases", () => {
  it("is perfect when the best sections come first, in order of grade", () => {
    const score = scoreRanking(["A", "B", "X"], relevant, 3);
    expect(score.ndcg).toBeCloseTo(1);
    expect(score.reciprocalRank).toBe(1);
  });

  it("puts a worse order lower, even when everything is found", () => {
    const good = scoreRanking(["A", "B", "X"], relevant, 3);
    const bad = scoreRanking(["B", "X", "A"], relevant, 3);
    expect(bad.recall).toBe(good.recall);
    expect(bad.ndcg).toBeLessThan(good.ndcg);
  });

  it("scores zero when nothing relevant is retrieved", () => {
    expect(scoreRanking(["X", "Y", "Z"], relevant, 3)).toEqual({
      hit: 0,
      recall: 0,
      precision: 0,
      reciprocalRank: 0,
      ndcg: 0,
    });
  });

  it("looks only at the top k, but the reciprocal rank looks further", () => {
    const score = scoreRanking(["X", "Y", "Z", "A"], relevant, 3);
    expect(score.hit).toBe(0); // A is at rank 4, outside the top 3
    expect(score.recall).toBe(0);
    expect(score.reciprocalRank).toBe(0.25);
  });

  it("recall is the share of relevant sections found", () => {
    const three = new Map([
      ["A", 2],
      ["B", 2],
      ["C", 2],
    ]);
    expect(scoreRanking(["A", "X", "Y"], three, 3).recall).toBeCloseTo(1 / 3);
  });

  it("counts a relevant section once: a second chunk of it adds nothing and takes a place", () => {
    // [A, A (another chunk of the same section), B]: A is found once, and B only just fits.
    const score = scoreRanking(["A", "A", "B"], relevant, 3);
    expect(score.recall).toBe(1);
    expect(score.precision).toBeCloseTo(2 / 3);
    // Compare with k = 2: the duplicate pushed B out of the top 2.
    expect(scoreRanking(["A", "A", "B"], relevant, 2).recall).toBe(0.5);
  });

  it("limits the ideal ranking to k places when more than k sections are relevant", () => {
    const many = new Map([
      ["A", 2],
      ["B", 2],
      ["C", 2],
      ["D", 2],
    ]);
    expect(scoreRanking(["A", "B", "C"], many, 3).ndcg).toBeCloseTo(1);
  });

  it("refuses a query with no relevant section", () => {
    expect(() => scoreRanking(["A"], new Map(), 3)).toThrow(/at least one relevant/);
  });
});

describe("aggregation", () => {
  const perfect = scoreRanking(["A", "B"], relevant, 3);
  const miss = scoreRanking(["X"], relevant, 3);

  it("averages each metric over queries", () => {
    // MRR example from the notes: first relevant at rank 1, rank 3 and not found: (1 + 1/3 + 0) / 3.
    const rr = [
      scoreRanking(["A"], relevant, 3),
      scoreRanking(["X", "Y", "B"], relevant, 3),
      scoreRanking(["X"], relevant, 3),
    ].map((s) => s.reciprocalRank);
    expect(rr).toEqual([1, 1 / 3, 0]);
    const mean = meanScore([perfect, miss])!;
    expect(mean.hit).toBe(0.5);
    expect(meanScore([])).toBeNull();
  });

  it("averages by tag, so a weak kind of query shows", () => {
    const byTag = meanScoreByTag([
      { tags: ["numeric"], score: perfect },
      { tags: ["numeric", "trap"], score: miss },
      { tags: ["paraphrase"], score: perfect },
    ]);
    expect(Object.keys(byTag)).toEqual(["numeric", "paraphrase", "trap"]);
    expect(byTag.numeric.count).toBe(2);
    expect(byTag.numeric.mean.hit).toBe(0.5);
    expect(byTag.paraphrase.mean.hit).toBe(1);
    expect(byTag.trap.mean.hit).toBe(0);
  });
});

describe("helpers", () => {
  it("builds a section key from the file and the heading path", () => {
    expect(sectionKey("data/lore/w/a.md", "A > B")).toBe("data/lore/w/a.md|A > B");
  });

  it("treats a best match below the floor, or no match, as an abstention", () => {
    expect(isAbstention(0.29, 0.3)).toBe(true);
    expect(isAbstention(0.3, 0.3)).toBe(false);
    expect(isAbstention(undefined, 0.3)).toBe(true);
  });
});
