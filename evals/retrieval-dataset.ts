import { z } from "zod";
import { type ChunkConfig, chunkMarkdown } from "../apps/web/src/lib/rag/chunking";
import type { LoreFile } from "../apps/web/src/lib/rag/lore-files";
import { type Grades, sectionKey } from "./retrieval-metrics";

/**
 * The retrieval eval set (evals/retrieval.jsonl): one JSON object per line, one query per object.
 *
 *   { "id": "q02", "world": "world_aethel", "query": "How much mana does teleportation cost?",
 *     "tags": ["numeric", "trap"],
 *     "relevant": [ { "file": "magic-system.md", "heading": "The Magic of Aethel > Casting Rules >
 *                     Teleportation", "grade": 2 }, ... ] }
 *
 * A label names a SECTION (file and heading path), not a chunk, so it stays true when the
 * chunking changes. Grade 2 = the section answers the question; grade 1 = related or partial
 * context. A query the lore cannot answer has no labels and the tag "negative".
 */
export const QUERY_TAGS = [
  "rule", // a rule of the world
  "numeric", // the answer is a number
  "proper-noun", // names a specific person, place or event
  "paraphrase", // asks in other words than the lore uses
  "multi-section", // needs more than one passage
  "conflict", // the lore disagrees with itself
  "trap", // a misleading passage is also close (for example an outdated figure)
  "history",
  "character",
  "negative", // the lore does not answer it
] as const;

const labelSchema = z.strictObject({
  file: z.string().min(1),
  heading: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2)]),
});

const queryCaseSchema = z.strictObject({
  id: z.string().regex(/^q\d{2,}$/, 'must look like "q01"'),
  world: z.string().min(1),
  query: z.string().min(1),
  tags: z.array(z.enum(QUERY_TAGS)).min(1),
  relevant: z.array(labelSchema),
});

export type QueryCase = z.infer<typeof queryCaseSchema>;

/** Parses the JSONL text. Every problem names its line, so a bad edit is easy to find. */
export function parseDataset(text: string): QueryCase[] {
  const problems: string[] = [];
  const cases: QueryCase[] = [];

  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const where = `line ${index + 1}`;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      problems.push(`${where}: not valid JSON`);
      return;
    }
    const parsed = queryCaseSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      problems.push(`${where}: ${issues}`);
      return;
    }
    const c = parsed.data;
    if (c.tags.includes("negative") !== (c.relevant.length === 0)) {
      problems.push(
        `${where} (${c.id}): the tag "negative" must be used exactly when there are no labels`,
      );
    }
    const labels = c.relevant.map((r) => `${r.file}|${r.heading}`);
    if (new Set(labels).size !== labels.length) {
      problems.push(`${where} (${c.id}): the same section is labeled twice`);
    }
    cases.push(c);
  });

  const ids = cases.map((c) => c.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    problems.push(`id ${id} is used more than once`);
  }
  if (problems.length > 0) throw new Error(`Invalid eval set:\n  - ${problems.join("\n  - ")}`);
  return cases;
}

/** The place of a section in the repository: files live in data/lore/<world>/. */
export function sourcePathOf(world: string, file: string): string {
  return `data/lore/${world}/${file}`;
}

/** The relevant sections of a query, keyed like the retrieved chunks are. */
export function relevantGrades(c: QueryCase): Grades {
  return new Map(
    c.relevant.map((r) => [sectionKey(sourcePathOf(c.world, r.file), r.heading), r.grade]),
  );
}

/** Every section that has text, i.e. every section a chunk can come from. */
export function corpusSectionKeys(files: readonly LoreFile[], config: ChunkConfig): Set<string> {
  return new Set(
    files.flatMap((file) =>
      chunkMarkdown(file.markdown, config).map((chunk) =>
        sectionKey(file.sourcePath, chunk.headingPath),
      ),
    ),
  );
}

/** Labels that point at a section that does not exist (a typo, or lore that was edited). */
export function findBrokenLabels(
  cases: readonly QueryCase[],
  corpus: ReadonlySet<string>,
): string[] {
  return cases.flatMap((c) =>
    c.relevant
      .filter((r) => !corpus.has(sectionKey(sourcePathOf(c.world, r.file), r.heading)))
      .map((r) => `${c.id}: no section "${r.heading}" in ${sourcePathOf(c.world, r.file)}`),
  );
}
