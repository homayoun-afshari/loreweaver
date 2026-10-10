/**
 * Retrieval metrics: how good is a ranked list of chunks, given which parts of the lore really
 * answer the question? Pure functions, no database and no network, so they can be checked
 * against numbers worked out by hand (see retrieval-metrics.test.ts).
 *
 * SCORING IS DONE ON SECTIONS, NOT ON CHUNKS. A section is one heading of one file. Chunk ids and
 * chunk boundaries change with every chunking configuration, so labels written against chunks
 * would break exactly when two configurations must be compared. A label names a section (file and
 * heading path), and a retrieved chunk "is" the section it was cut from. Rules:
 *
 *  - Rank is the position in the list of CHUNKS, so a configuration that cuts a section into
 *    several pieces pays for it: they take up places in the top k.
 *  - A relevant section counts once, the first time one of its chunks appears. A later chunk of
 *    a section that was already found has no gain (it takes a place and adds nothing).
 *  - Grades: 2 = answers the question, 1 = related or partial context.
 */

/** The identity of a section: its file and its heading path. */
export function sectionKey(sourcePath: string, headingPath: string): string {
  return `${sourcePath}|${headingPath}`;
}

/** The relevant sections of one query, with their grades (only grades above 0). */
export type Grades = ReadonlyMap<string, number>;

export type QueryScore = {
  /** 1 if at least one relevant section is in the top k, else 0. */
  hit: number;
  /** Relevant sections found in the top k / all relevant sections. */
  recall: number;
  /** Relevant sections found in the top k / k. */
  precision: number;
  /** 1 / rank of the first relevant chunk in the whole ranking, or 0 if there is none. */
  reciprocalRank: number;
  /** Discounted cumulative gain of the top k / the best possible (graded gain, log2 discount). */
  ndcg: number;
};

/** Gain divided by log2(rank + 1), summed. Ranks start at 1, so the first place is not discounted. */
function discountedGain(gains: readonly number[]): number {
  return gains.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
}

/**
 * Scores one ranking. `ranked` holds the section key of every retrieved chunk, best first.
 * The reciprocal rank looks at the whole ranking (the depth the caller retrieved); the other
 * metrics look at the top `k`.
 */
export function scoreRanking(ranked: readonly string[], relevant: Grades, k: number): QueryScore {
  if (relevant.size === 0) {
    throw new Error(
      "scoreRanking needs at least one relevant section (a query without answer has no score).",
    );
  }
  const seen = new Set<string>();
  const gains = ranked.map((key) => {
    if (seen.has(key)) return 0; // an extra chunk of a section that was already found
    seen.add(key);
    return relevant.get(key) ?? 0;
  });

  const top = gains.slice(0, k);
  const found = top.filter((gain) => gain > 0).length;
  const firstRelevant = gains.findIndex((gain) => gain > 0);

  // The best possible list puts the highest grades first, and cannot be longer than k.
  const ideal = discountedGain([...relevant.values()].sort((a, b) => b - a).slice(0, k));

  return {
    hit: found > 0 ? 1 : 0,
    recall: found / relevant.size,
    precision: found / k,
    reciprocalRank: firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1),
    ndcg: ideal === 0 ? 0 : discountedGain(top) / ideal,
  };
}

/** The mean of each metric over several queries, or null for none. */
export function meanScore(scores: readonly QueryScore[]): QueryScore | null {
  if (scores.length === 0) return null;
  const mean = (pick: (s: QueryScore) => number) =>
    scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
  return {
    hit: mean((s) => s.hit),
    recall: mean((s) => s.recall),
    precision: mean((s) => s.precision),
    reciprocalRank: mean((s) => s.reciprocalRank),
    ndcg: mean((s) => s.ndcg),
  };
}

/** The mean scores of the queries that carry each tag, so weak spots show (for example "proper-noun"). */
export function meanScoreByTag(
  items: readonly { tags: readonly string[]; score: QueryScore }[],
): Record<string, { count: number; mean: QueryScore }> {
  const tags = [...new Set(items.flatMap((item) => item.tags))].sort();
  return Object.fromEntries(
    tags.map((tag) => {
      const scores = items.filter((item) => item.tags.includes(tag)).map((item) => item.score);
      return [tag, { count: scores.length, mean: meanScore(scores)! }];
    }),
  );
}

/**
 * Would the search return nothing for this query? True if the best match is below the similarity
 * floor (or there is no match at all). For a question the lore cannot answer that is the right
 * outcome; for a question it can answer, it is a mistake.
 */
export function isAbstention(topSimilarity: number | undefined, floor: number): boolean {
  return topSimilarity === undefined || topSimilarity < floor;
}
