import type { CaseResult } from "./e2e-report";

/**
 * Checking the judge against a human. A sample of answers from a report is written out WITHOUT the
 * judge's grades, a person labels each one (pass or fail, and a faithfulness score from 1 to 5), and
 * the labels are compared with what the judge said. Pure functions, so the arithmetic and the
 * parsing are tested without a model.
 */

export type Label = {
  report: string;
  caseId: string;
  pass: boolean;
  faithfulness: number;
  notes: string;
};

/** `count` indexes spread evenly over a list of `length` items. */
function spread(length: number, count: number): number[] {
  if (count >= length) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.floor(((i + 0.5) * length) / count));
}

/**
 * The cases to label: about half the ones the judge failed and half the ones it passed, spread
 * evenly over the list sorted by id, so the sample does not depend on chance and shows the judge's
 * passes as closely as its fails. If one side is short, the other fills the sample. Cases without a
 * judge grade cannot be compared and are left out. The result is sorted by id.
 */
export function pickSample(results: CaseResult[], n: number): CaseResult[] {
  const graded = results.filter((r) => r.judge).sort((a, b) => a.id.localeCompare(b.id));
  const failed = graded.filter((r) => !r.judge!.pass);
  const passed = graded.filter((r) => r.judge!.pass);
  let nFailed = Math.min(failed.length, Math.ceil(n / 2));
  let nPassed = Math.min(passed.length, n - nFailed);
  nFailed = Math.min(failed.length, n - nPassed);
  const chosen = [
    ...spread(failed.length, nFailed).map((i) => failed[i]),
    ...spread(passed.length, nPassed).map((i) => passed[i]),
  ];
  return chosen.sort((a, b) => a.id.localeCompare(b.id));
}

const RULES = `For each answer, decide two things the way the judge was asked to:

- **Faithfulness (1 to 5):** is every claim about the world or the character supported by the evidence shown? 5 = all supported. 4 = every rule, number, item and place supported, at most one small neutral detail beyond. 3 = one unsupported or wrong claim that could matter to the story. 2 = several unsupported claims, or one that contradicts the evidence. 1 = the core is invented or contradicts the rules or the character's state. An honest "the lore does not cover this" is supported. Ignore style, length and omissions.
- **Pass:** pass only if faithfulness is 4 or 5 **and** every numbered constraint is clearly satisfied. If the answer is silent on a constraint or only hints at it, that constraint fails.

Write your two labels in \`evals/judge-labels.csv\` (\`human_pass\`: pass or fail; \`human_faithfulness\`: 1 to 5). The judge's grades are not shown here on purpose.`;

/** The reading copy of the sample: everything a person needs to label, and nothing of the judge's grade. */
export function renderReview(sample: CaseResult[], reportName: string): string {
  const blocks = sample.map((r, i) => {
    const constraints = r.judge!.constraints.map((c, j) => `${j + 1}. ${c.constraint}`).join("\n");
    const evidence = r.evidence.length > 0 ? r.evidence.join("\n") : "(no tool was called)";
    return [
      `## ${i + 1}. ${r.id}`,
      "",
      "**Question**",
      "",
      r.input,
      "",
      "**Evidence the agent had**",
      "",
      "```text",
      evidence,
      "```",
      "",
      "**True character record**",
      "",
      r.characterRecord ?? "(the question names no character)",
      "",
      "**Answer**",
      "",
      "```text",
      r.answer.trim() === "" ? "(empty)" : r.answer,
      "```",
      "",
      "**Constraints**",
      "",
      constraints,
      "",
    ].join("\n");
  });
  return [
    `# Labeling sheet for ${reportName}`,
    "",
    `${sample.length} answers.`,
    "",
    RULES,
    "",
    "---",
    "",
    blocks.join("\n---\n\n"),
  ].join("\n");
}

const HEADER = "report,case_id,human_pass,human_faithfulness,notes";

/** The empty file to fill in: one row per case of the sample. */
export function csvTemplate(reportName: string, sample: CaseResult[]): string {
  return `${[HEADER, ...sample.map((r) => `${reportName},${r.id},,,`)].join("\n")}\n`;
}

/** Splits CSV text into rows of fields. Handles quoted fields with commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const PASS_WORDS = new Map([
  ["pass", true],
  ["p", true],
  ["true", true],
  ["yes", true],
  ["y", true],
  ["1", true],
  ["fail", false],
  ["f", false],
  ["false", false],
  ["no", false],
  ["n", false],
  ["0", false],
]);

export type ParsedLabels = { labels: Label[]; unlabeled: string[] };

/**
 * Reads the labeling file. A row with both labels empty is "unlabeled" (listed, not an error); a row
 * with one label, or with a value that is not understood, throws one error that lists every problem.
 */
export function parseLabels(text: string): ParsedLabels {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.map((h) => h.trim()).join(",") !== HEADER) {
    throw new Error(`judge-labels.csv: the first line must be "${HEADER}"`);
  }
  const labels: Label[] = [];
  const unlabeled: string[] = [];
  const problems: string[] = [];
  rows.forEach((row, i) => {
    const [report = "", caseId = "", rawPass = "", rawScore = "", notes = ""] = row.map((f) =>
      f.trim(),
    );
    const where = `row ${i + 2} (${caseId || "no id"})`;
    if (caseId === "") return void problems.push(`${where}: case_id is empty`);
    if (rawPass === "" && rawScore === "") return void unlabeled.push(caseId);
    const pass = PASS_WORDS.get(rawPass.toLowerCase());
    const faithfulness = Number(rawScore);
    if (pass === undefined) problems.push(`${where}: human_pass "${rawPass}" is not pass or fail`);
    if (
      !Number.isInteger(faithfulness) ||
      faithfulness < 1 ||
      faithfulness > 5 ||
      rawScore === ""
    ) {
      problems.push(`${where}: human_faithfulness "${rawScore}" is not a whole number from 1 to 5`);
    }
    if (pass !== undefined && Number.isInteger(faithfulness) && rawScore !== "") {
      labels.push({ report, caseId, pass, faithfulness, notes });
    }
  });
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.caseId)) problems.push(`case ${l.caseId} is labeled twice`);
    seen.add(l.caseId);
  }
  if (problems.length > 0)
    throw new Error(`judge-labels.csv is invalid:\n  - ${problems.join("\n  - ")}`);
  return { labels, unlabeled };
}

export type Disagreement = {
  caseId: string;
  judgePass: boolean;
  humanPass: boolean;
  judgeFaithfulness: number;
  humanFaithfulness: number;
  notes: string;
};

/** How often the judge agrees with the labels, over the labeled cases that have a judge grade. */
export function computeAgreement(results: CaseResult[], labels: Label[]) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const missing = labels.filter((l) => !byId.get(l.caseId)?.judge).map((l) => l.caseId);
  const rows = labels.flatMap((l) => {
    const judge = byId.get(l.caseId)?.judge;
    return judge ? [{ label: l, judge }] : [];
  });
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const disagreements: Disagreement[] = rows
    .filter(
      ({ label, judge }) => label.pass !== judge.pass || label.faithfulness !== judge.faithfulness,
    )
    .map(({ label, judge }) => ({
      caseId: label.caseId,
      judgePass: judge.pass,
      humanPass: label.pass,
      judgeFaithfulness: judge.faithfulness,
      humanFaithfulness: label.faithfulness,
      notes: label.notes,
    }));
  return {
    n: rows.length,
    /** Labels for a case the report has no judge grade for. */
    missing,
    passAgreement: count(({ label, judge }) => label.pass === judge.pass),
    faithfulnessExact: count(({ label, judge }) => label.faithfulness === judge.faithfulness),
    faithfulnessWithinOne: count(
      ({ label, judge }) => Math.abs(label.faithfulness - judge.faithfulness) <= 1,
    ),
    /** The judge's mean faithfulness minus the human's: above 0 means the judge is the more lenient. */
    meanFaithfulnessGap:
      rows.length === 0
        ? undefined
        : rows.reduce((t, { label, judge }) => t + judge.faithfulness - label.faithfulness, 0) /
          rows.length,
    judgePassHumanFail: count(({ label, judge }) => judge.pass && !label.pass),
    judgeFailHumanPass: count(({ label, judge }) => !judge.pass && label.pass),
    disagreements,
  };
}
