import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { CHARS_PER_TOKEN } from "./constants";

/** How to cut a document. Different values are compared in the chunking experiment. */
export type ChunkConfig = {
  /** Upper limit of a chunk's size, in (estimated) tokens. */
  maxTokens: number;
  /** How much of the previous chunk is repeated at the start of the next one (same section only). */
  overlapTokens: number;
  /** Whether the heading path is put in front of the text that gets embedded. */
  embedHeadings: boolean;
};

/**
 * The named configurations. The name is stored with every chunk, so chunks made with different
 * configurations can sit in the same table and be compared. The default is a starting point,
 * until the experiment decides.
 *
 * Note on sizes: every section of the current Lore Bible is at most about 180 tokens, so any cap
 * of 200 or more gives the same chunks (one per section). That is why the second configuration
 * is as small as 80: it is the first size at which the long sections really get split.
 */
export const CHUNK_CONFIGS = {
  "heading-800": { maxTokens: 800, overlapTokens: 80, embedHeadings: true },
  "heading-80": { maxTokens: 80, overlapTokens: 8, embedHeadings: true },
} as const satisfies Record<string, ChunkConfig>;

export type ChunkConfigName = keyof typeof CHUNK_CONFIGS;
export const DEFAULT_CHUNK_CONFIG: ChunkConfigName = "heading-800";

export type Chunk = {
  /** The headings above the chunk, joined with " > ". Empty for text before the first heading. */
  headingPath: string;
  content: string;
};

export const HEADING_SEPARATOR = " > ";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The exact text sent to the embedding model for a chunk. */
export function textToEmbed(chunk: Chunk, config: ChunkConfig): string {
  return config.embedHeadings && chunk.headingPath
    ? `${chunk.headingPath}\n\n${chunk.content}`
    : chunk.content;
}

type Section = { headingPath: string; body: string };

/**
 * Cuts Markdown into chunks: first at headings, then, if a section is too long, by paragraphs
 * and sentences, with a little overlap. The Markdown has no front matter here (the caller strips it).
 */
export function chunkMarkdown(markdown: string, config: ChunkConfig): Chunk[] {
  return splitIntoSections(markdown).flatMap((section) => splitSection(section, config));
}

/**
 * One section per heading: the text between that heading and the next one, with the path of
 * headings above it. A real Markdown parser finds the headings, so a line starting with "#"
 * inside a code block is not mistaken for one.
 */
function splitIntoSections(markdown: string): Section[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  // Only top-level headings count. Headings are always top-level in a normal document.
  const headings = tree.children.filter((node): node is Heading => node.type === "heading");

  const sections: Section[] = [];
  const firstStart = headings[0]?.position?.start.offset ?? markdown.length;
  sections.push({ headingPath: "", body: markdown.slice(0, firstStart).trim() });

  const path: string[] = [];
  headings.forEach((heading, i) => {
    // A "##" under a "#" keeps the "#" in the path. A new "#" starts again from the top.
    path.length = Math.min(path.length, heading.depth - 1);
    path.push(toString(heading).trim());

    const bodyStart = heading.position?.end.offset ?? 0;
    const bodyEnd = headings[i + 1]?.position?.start.offset ?? markdown.length;
    sections.push({
      headingPath: path.join(HEADING_SEPARATOR),
      body: markdown.slice(bodyStart, bodyEnd).trim(),
    });
  });
  return sections;
}

/** A piece of text that is never split further, and the separator that goes before it. */
type Unit = { text: string; separator: string };

function splitSection(section: Section, config: ChunkConfig): Chunk[] {
  const { headingPath, body } = section;
  if (body === "") return []; // A heading directly followed by another heading has no text.

  const maxChars = config.maxTokens * CHARS_PER_TOKEN;
  if (body.length <= maxChars) return [{ headingPath, content: body }];

  const overlapChars = config.overlapTokens * CHARS_PER_TOKEN;
  // Leave room for the overlap and the space after it, so a restarted chunk still fits.
  const unitLimit = Math.max(1, maxChars - overlapChars - 1);

  const contents: string[] = [];
  let current = "";
  for (const unit of toUnits(body, unitLimit)) {
    const joined = current === "" ? unit.text : current + unit.separator + unit.text;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    // The unit does not fit: close the current chunk and start the next one with an overlap.
    contents.push(current);
    const tail = tailAtWordBoundary(current, overlapChars);
    current = tail === "" ? unit.text : `${tail} ${unit.text}`;
  }
  if (current !== "") contents.push(current);

  return contents.map((content) => ({ headingPath, content }));
}

/** Paragraphs; a paragraph that is too long becomes sentences; a sentence that is too long becomes words. */
function toUnits(body: string, limit: number): Unit[] {
  const units: Unit[] = [];
  for (const paragraph of body.split(/\n{2,}/).map((p) => p.trim())) {
    if (paragraph === "") continue;
    if (paragraph.length <= limit) {
      units.push({ text: paragraph, separator: "\n\n" });
      continue;
    }
    paragraph.split(/(?<=[.!?])\s+/).forEach((sentence, i) => {
      const pieces = sentence.length <= limit ? [sentence] : splitByWords(sentence, limit);
      pieces.forEach((piece, j) =>
        units.push({ text: piece, separator: i === 0 && j === 0 ? "\n\n" : " " }),
      );
    });
  }
  return units;
}

function splitByWords(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const joined = current === "" ? word : `${current} ${word}`;
    if (joined.length <= limit || current === "") {
      current = joined; // A single word longer than the limit stays whole.
    } else {
      pieces.push(current);
      current = word;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

/** The last `size` characters of `text`, without a word cut in half at the start. */
function tailAtWordBoundary(text: string, size: number): string {
  if (size <= 0) return "";
  if (text.length <= size) return text;
  const tail = text.slice(-size);
  const firstSpace = tail.search(/\s/);
  return firstSpace === -1 ? tail : tail.slice(firstSpace).trim();
}
