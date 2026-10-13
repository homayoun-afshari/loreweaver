/**
 * Prints the summaries of eval reports side by side, as a Markdown table, and, for exactly two
 * reports, the cases whose verdict changed. It reads the summary each report stored and recomputes
 * nothing, calls no model and costs nothing, so the same reports always give the same table.
 *
 *   pnpm eval:summary evals/reports/e2e-A.json evals/reports/e2e-B.json
 *   pnpm eval:summary evals/reports/e2e-A.json evals/reports/e2e-B.json --names before,after
 *   pnpm eval:summary evals/reports/redteam-*.json
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { changedCases, renderTable, type StoredReport } from "./e2e-compare";

const { values, positionals } = parseArgs({
  options: { names: { type: "string" } },
  allowPositionals: true,
});

async function main() {
  if (positionals.length === 0) throw new Error("give at least one report of evals/reports/");
  const names = values.names?.split(",").map((n) => n.trim());
  if (names && names.length !== positionals.length) {
    throw new Error(`--names has ${names.length} names for ${positionals.length} reports`);
  }
  // `pnpm --filter web exec` runs in apps/web, so a path from the repository folder is tried there too.
  const files = positionals.map((p) =>
    [resolve(p), resolve("../..", p)].find((f) => existsSync(f)),
  );
  const missing = positionals.filter((_, i) => !files[i]);
  if (missing.length > 0) throw new Error(`no such report: ${missing.join(", ")}`);

  const reports = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(f!, "utf8")) as StoredReport),
  );
  console.log(renderTable(reports.map((report, i) => ({ name: names?.[i], report }))));
  console.log(`\nReports: ${files.map((f) => basename(f!)).join(", ")}`);

  if (reports.length === 2) {
    const { fixed, regressed, onlyBefore, onlyAfter } = changedCases(reports[0], reports[1]);
    console.log(`\nFixed (fail, then pass): ${fixed.join(", ") || "none"}`);
    console.log(`Regressed (pass, then fail): ${regressed.join(", ") || "none"}`);
    if (onlyBefore.length + onlyAfter.length > 0) {
      console.log(
        `Only in the first: ${onlyBefore.join(", ") || "none"}. Only in the second: ${onlyAfter.join(", ") || "none"}.`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
