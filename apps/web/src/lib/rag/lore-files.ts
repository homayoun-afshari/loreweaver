import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DOC_TYPES, type DocType } from "./constants";

/** One Markdown file of the Lore Bible, ready to be chunked. */
export type LoreFile = {
  /** The tenant, taken from the folder name (data/lore/<worldId>/...). */
  worldId: string;
  /** Repo-relative path with forward slashes, the same on every operating system. */
  sourcePath: string;
  docType: DocType;
  /** The Markdown text after the front matter, with "\n" line endings. */
  markdown: string;
};

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Reads the small front matter block at the top of a lore file (`doc_type: rule`).
 * Only "key: value" lines are supported, which is all the lore files need.
 * Line endings are normalised first: on Windows, Git can check files out with "\r\n", and the
 * same file must give the same chunks (and hashes) on every machine.
 */
export function parseLoreFile(
  raw: string,
  where: { worldId: string; sourcePath: string },
): LoreFile {
  const text = raw.replace(/\r\n/g, "\n");
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    throw new Error(
      `${where.sourcePath}: missing front matter. Start the file with "---", "doc_type: ...", "---".`,
    );
  }

  const data = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key.trim() !== "") data.set(key.trim(), rest.join(":").trim());
  }

  const docType = data.get("doc_type");
  if (!DOC_TYPES.includes(docType as DocType)) {
    throw new Error(
      `${where.sourcePath}: doc_type must be one of ${DOC_TYPES.join(", ")} (got "${docType ?? ""}").`,
    );
  }
  return { ...where, docType: docType as DocType, markdown: text.slice(match[0].length) };
}

/**
 * Loads every `<root>/<world>/*.md` file, in a stable order (so runs are reproducible).
 * Files directly inside `root` (like the README) and other file types are ignored.
 * `worlds` limits the result to some worlds; asking for a world that has no files is an error.
 */
export async function loadLoreFiles(root: string, worlds?: string[]): Promise<LoreFile[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const available = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const world of worlds ?? []) {
    if (!available.includes(world)) {
      throw new Error(
        `No lore folder for world "${world}". Found: ${available.join(", ") || "none"}.`,
      );
    }
  }

  const files: LoreFile[] = [];
  for (const worldId of worlds ?? available) {
    const names = (await readdir(path.join(root, worldId))).filter((n) => n.endsWith(".md")).sort();
    for (const name of names) {
      const raw = await readFile(path.join(root, worldId, name), "utf8");
      files.push(parseLoreFile(raw, { worldId, sourcePath: `data/lore/${worldId}/${name}` }));
    }
  }
  return files;
}
