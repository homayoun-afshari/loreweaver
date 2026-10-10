import { describe, expect, it } from "vitest";
import { parseFeedbackRequest, toFeedbackRow } from "./feedback-request";

const valid = { chatId: "chat-1", messageId: "msg-1", kind: "up" } as const;

describe("parseFeedbackRequest", () => {
  it("accepts the three kinds of event", () => {
    for (const kind of ["up", "down", "copy"]) {
      expect(parseFeedbackRequest({ ...valid, kind })?.kind).toBe(kind);
    }
  });

  it("rejects an unknown kind, missing ids and oversized values", () => {
    expect(parseFeedbackRequest({ ...valid, kind: "love" })).toBeNull();
    expect(parseFeedbackRequest({ chatId: "c", kind: "up" })).toBeNull();
    expect(parseFeedbackRequest({ ...valid, messageId: "x".repeat(101) })).toBeNull();
    expect(parseFeedbackRequest(null)).toBeNull();
  });
});

describe("toFeedbackRow", () => {
  it("keeps an allowlisted model and a simple prompt version", () => {
    const row = toFeedbackRow({
      ...valid,
      modelId: "claude-sonnet-5-5",
      promptVersion: "agent.v1",
    });
    expect(row).toMatchObject({ modelId: "claude-sonnet-5-5", promptVersion: "agent.v1" });
  });

  it("drops labels that are not ones we produce", () => {
    const row = toFeedbackRow({ ...valid, modelId: "gpt-evil", promptVersion: "x y; DROP TABLE" });
    expect(row.modelId).toBeNull();
    expect(row.promptVersion).toBeNull();
  });
});
