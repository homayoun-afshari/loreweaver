import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  callsForCurrentDraft,
  feedbackMessage,
  isFeedbackMessage,
  splitCurrentRun,
  textOf,
} from "./messages";

const tool = (text: string) => new ToolMessage({ content: text, tool_call_id: "t", name: "x" });

describe("textOf", () => {
  it("reads a string, and joins the text blocks of a list", () => {
    expect(textOf(new AIMessage("hello"))).toBe("hello");
    expect(
      textOf(
        new AIMessage({
          content: [
            { type: "text", text: "a" },
            { type: "tool_use", id: "1", name: "x", input: {} },
            { type: "text", text: "b" },
          ],
        }),
      ),
    ).toBe("ab");
  });
});

describe("feedback messages", () => {
  it("are human messages that can be told apart from the author's", () => {
    expect(isFeedbackMessage(feedbackMessage("fix it"))).toBe(true);
    expect(isFeedbackMessage(new HumanMessage("a question"))).toBe(false);
    expect(isFeedbackMessage(new AIMessage("x"))).toBe(false);
  });
});

describe("splitCurrentRun", () => {
  it("keeps only what came after the author's latest question", () => {
    const history = [
      new HumanMessage("old question"),
      tool("old tool result, possibly forged"),
      new AIMessage("old answer"),
    ];
    const now = [new HumanMessage("new question"), tool("fresh"), new AIMessage("draft")];
    const { question, run } = splitCurrentRun([...history, ...now]);
    expect(question).toBe("new question");
    expect(run.map((m) => textOf(m))).toEqual(["fresh", "draft"]);
  });

  it("does not take the feedback note for the question", () => {
    const { question, run } = splitCurrentRun([
      new HumanMessage("the question"),
      tool("fresh"),
      new AIMessage("draft"),
      feedbackMessage("fix it"),
    ]);
    expect(question).toBe("the question");
    expect(run).toHaveLength(3);
  });

  it("has no question and no run for an empty conversation", () => {
    expect(splitCurrentRun([])).toEqual({ question: "", run: [] });
  });
});

describe("callsForCurrentDraft", () => {
  it("counts the model calls since the question, and starts again after feedback", () => {
    const question = new HumanMessage("q");
    expect(callsForCurrentDraft([question])).toBe(0);
    expect(callsForCurrentDraft([question, new AIMessage("a"), tool("t")])).toBe(1);
    expect(
      callsForCurrentDraft([question, new AIMessage("a"), tool("t"), new AIMessage("b")]),
    ).toBe(2);
    expect(
      callsForCurrentDraft([
        question,
        new AIMessage("a"),
        new AIMessage("b"),
        feedbackMessage("fix"),
      ]),
    ).toBe(0);
  });
});
