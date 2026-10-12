/**
 * Checks the judge of the end-to-end eval against a person's labels. No model is called.
 *
 *   pnpm eval:labels --report evals/reports/e2e-<run>.json                 write the sheet to label
 *   pnpm eval:labels --report evals/reports/e2e-<run>.json --agreement     compare the labels with the judge
 *
 * The first form picks about 10 answers from the report and writes two files: a reading copy next
 * to the report (`<report>-labeling.md`, with the question, the evidence, the true character record,
 * the answer and the constraints, but not the judge's grades) and an empty `evals/judge-labels.csv`
 * to fill in. It refuses to overwrite a CSV that already has labels. The second form reads the CSV
 * and prints how often the judge agrees, and where it does not.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { computeAgreement, csvTemplate, parseLabels, pickSample, renderReview } from "./e2e-labels";
import type { CaseResult } from "./e2e-report";

const LABELS = fileURLToPath(new URL("./judge-labels.csv", import.meta.url));

const { values: args } = parseArgs({
  options: {
    report: { type: "string" },
    n: { type: "string", default: "10" },
    agreement: { type: "boolean", default: false },
  },
});

async function main() {
  if (!args.report) throw new Error("--report <path to a report in evals/reports/> is required");
  // `pnpm --filter web exec` runs in apps/web, so a path given from the repo root is tried there too.
  const reportPath = [resolve(args.report), resolve("../..", args.report)].find((p) =>
    existsSync(p),
  );
  if (!reportPath) throw new Error(`no such report: ${args.report}`);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { results: CaseResult[] };
  const reportName = basename(reportPath);

  if (!args.agreement) {
    const existing = existsSync(LABELS) ? await readFile(LABELS, "utf8") : "";
    if (existing && parseLabels(existing).labels.length > 0) {
      throw new Error(
        "evals/judge-labels.csv already has labels. Move it away first; it is not overwritten.",
      );
    }
    const sample = pickSample(report.results, Number(args.n));
    if (sample.some((r) => r.evidence === undefined)) {
      throw new Error(
        "this report has no evidence (it predates the labeling sheet); run pnpm eval again",
      );
    }
    const review = reportPath.replace(/\.json$/, "-labeling.md");
    await writeFile(review, renderReview(sample, reportName));
    await writeFile(LABELS, csvTemplate(reportName, sample));
    console.log(`${sample.length} answers picked: ${sample.map((r) => r.id).join(", ")}`);
    console.log(`Read:  ${review}`);
    console.log("Fill:  evals/judge-labels.csv (human_pass, human_faithfulness, notes)");
    console.log("Then:  pnpm eval:labels --report <the same report> --agreement");
    return;
  }

  const { labels, unlabeled } = parseLabels(await readFile(LABELS, "utf8"));
  const wrong = labels.filter((l) => l.report !== reportName);
  if (wrong.length > 0) {
    throw new Error(`labels were written for ${wrong[0].report}, not for ${reportName}`);
  }
  if (unlabeled.length > 0) console.log(`Unlabeled, left out: ${unlabeled.join(", ")}`);
  const a = computeAgreement(report.results, labels);
  if (a.missing.length > 0)
    console.log(`No judge grade in the report for: ${a.missing.join(", ")}`);
  if (a.n === 0) throw new Error("no labeled case to compare");
  const pct = (k: number) => `${((k / a.n) * 100).toFixed(0)}% (${k}/${a.n})`;
  console.log(`\nJudge against ${a.n} hand labels of ${reportName}\n`);
  console.log("| Measure | Value |");
  console.log("| --- | ---: |");
  console.log(`| Same pass / fail verdict | ${pct(a.passAgreement)} |`);
  console.log(`| Same faithfulness score | ${pct(a.faithfulnessExact)} |`);
  console.log(`| Faithfulness within 1 point | ${pct(a.faithfulnessWithinOne)} |`);
  console.log(`| Mean faithfulness, judge minus human | ${a.meanFaithfulnessGap?.toFixed(2)} |`);
  console.log(`| Judge passed, human failed | ${a.judgePassHumanFail} |`);
  console.log(`| Judge failed, human passed | ${a.judgeFailHumanPass} |`);
  if (a.disagreements.length > 0) {
    console.log("\n| Case | Judge | Human | Notes |");
    console.log("| --- | --- | --- | --- |");
    for (const d of a.disagreements) {
      const verdict = (pass: boolean, score: number) => `${pass ? "pass" : "fail"}, ${score}`;
      console.log(
        `| ${d.caseId} | ${verdict(d.judgePass, d.judgeFaithfulness)} | ${verdict(d.humanPass, d.humanFaithfulness)} | ${d.notes} |`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
