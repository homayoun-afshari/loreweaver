import type { DocType } from "@/lib/rag/constants";

/** Longest snippet shown on a collapsed card, in characters. */
export const SNIPPET_MAX_CHARS = 160;

/** The file name of a source path: "data/lore/world_aethel/magic-system.md" becomes "magic-system.md". */
export function fileName(sourcePath: string): string {
  return sourcePath.split("/").at(-1) ?? sourcePath;
}

/**
 * The first part of a passage, on one line, cut at a word and ended with "…" if it was cut.
 * Whitespace (including line breaks) is collapsed so the card stays compact.
 */
export function snippet(content: string, max = SNIPPET_MAX_CHARS): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  rule: "Rule",
  location: "Location",
  history: "History",
  character: "Character",
};

export function docTypeLabel(docType: DocType): string {
  return DOC_TYPE_LABELS[docType] ?? docType;
}

/** The line above the cards. */
export function sourcesSummary(count: number): string {
  return count === 1 ? "1 source from your lore" : `${count} sources from your lore`;
}

/** A short message for the error card. Internal details are never shown. */
export function describeSearchError(): { title: string; detail: string } {
  return {
    title: "Lore search unavailable",
    detail: "The lore could not be searched, so the answer may be missing sources.",
  };
}
