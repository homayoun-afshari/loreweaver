import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { buildJudgeMessages, judgeCostUsd, toGrade } from "./e2e-judge";

const constraints = ["Says it needs flint", "Does not teleport her"];
const reply = (over: object = {}) => ({
  reasoning: "The answer follows the lore.",
  scores: {
    faithfulness: 5,
    constraints: [
      { index: 1, pass: true },
      { index: 2, pass: true },
    ],
  },
  pass: true,
  ...over,
});

describe("toGrade", () => {
  it("accepts a complete reply and attaches each constraint to its text", () => {
    const grade = toGrade(reply(), constraints);
    expect(grade).toMatchObject({ faithfulness: 5, pass: true, judgePass: true });
    expect(grade?.constraints).toEqual([
      { constraint: "Says it needs flint", pass: true },
      { constraint: "Does not teleport her", pass: true },
    ]);
  });

  it("fails an answer whose faithfulness is below the threshold, whatever the judge says", () => {
    const grade = toGrade(reply({ scores: { ...reply().scores, faithfulness: 3 } }), constraints);
    expect(grade).toMatchObject({ pass: false, judgePass: true });
  });

  it("fails an answer with a failed constraint, whatever the judge says", () => {
    const scores = {
      faithfulness: 5,
      constraints: [
        { index: 1, pass: true },
        { index: 2, pass: false },
      ],
    };
    expect(toGrade(reply({ scores }), constraints)).toMatchObject({ pass: false, judgePass: true });
  });

  it("rejects a reply that misses, repeats or invents a constraint", () => {
    const withConstraints = (list: { index: number; pass: boolean }[]) =>
      reply({ scores: { faithfulness: 5, constraints: list } });
    expect(toGrade(withConstraints([{ index: 1, pass: true }]), constraints)).toBeNull();
    expect(
      toGrade(
        withConstraints([
          { index: 1, pass: true },
          { index: 1, pass: true },
        ]),
        constraints,
      ),
    ).toBeNull();
    expect(
      toGrade(
        withConstraints([
          { index: 1, pass: true },
          { index: 3, pass: true },
        ]),
        constraints,
      ),
    ).toBeNull();
  });

  it("rejects a reply of the wrong shape or with a score out of range", () => {
    expect(toGrade(null, constraints)).toBeNull();
    expect(toGrade({ reasoning: "x" }, constraints)).toBeNull();
    expect(
      toGrade(reply({ scores: { ...reply().scores, faithfulness: 6 } }), constraints),
    ).toBeNull();
  });
});

describe("buildJudgeMessages", () => {
  const messages = buildJudgeMessages({
    question: "Can Aria cast fire?",
    toolMessages: [
      new ToolMessage({
        name: "search_lore",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          hits: [
            {
              citationId: "3fa9c1d2",
              headingPath: "Casting Rules",
              content: "Flint lets it pass.",
            },
          ],
        }),
      }),
    ],
    knownCharacters: "1 = Aria Voss, 2 = Brannoc Hale",
    characterRecord: "Aria Voss carries: flint.",
    answer: "Yes, with her flint [3fa9c1d2].",
    constraints,
  });

  it("puts the rubric first and the data in tagged blocks", () => {
    expect(messages[0].type).toBe("system");
    const text = (messages[1] as HumanMessage).content as string;
    expect(text).toContain("<question>\nCan Aria cast fire?\n</question>");
    expect(text).toContain("passage 3fa9c1d2");
    expect(text).toContain(
      "<known_characters>\n1 = Aria Voss, 2 = Brannoc Hale\n</known_characters>",
    );
    expect(text).toContain("<character_record>\nAria Voss carries: flint.");
    expect(text).toContain("<answer>\nYes, with her flint [3fa9c1d2].");
    expect(text).toContain("1. Says it needs flint\n2. Does not teleport her");
  });

  it("says so when no tool was called and no character is named", () => {
    const text = buildJudgeMessages({
      question: "q",
      toolMessages: [],
      knownCharacters: "none",
      characterRecord: null,
      answer: "",
      constraints,
    })[1].content as string;
    expect(text).toContain("(no tool was called)");
    expect(text).toContain("(the question names no character)");
    expect(text).toContain("<answer>\n(empty)");
  });
});

describe("judgeCostUsd", () => {
  it("prices plain input, cache reads, cache writes and output at Opus 5.5 rates", () => {
    // 1,000 plain + 1,000 read + 1,000 written input, and 1,000 output tokens.
    const cost = judgeCostUsd({ input: 3000, output: 1000, cacheRead: 1000, cacheWrite: 1000 });
    expect(cost).toBeCloseTo((1000 * 4 + 1000 * 0.2 + 1000 * 5 + 1000 * 20) / 1e6, 10);
  });

  it("is zero for no tokens", () => {
    expect(judgeCostUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });
});
