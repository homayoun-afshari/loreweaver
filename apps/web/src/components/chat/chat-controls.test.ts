import { describe, expect, it } from "vitest";
import { canRegenerate, messageLengthStatus } from "./chat-controls";

describe("canRegenerate", () => {
  it("is offered after an answer, and after a question that was stopped before any answer", () => {
    expect(canRegenerate({ busy: false, lastRole: "assistant" })).toBe(true);
    expect(canRegenerate({ busy: false, lastRole: "user" })).toBe(true);
  });

  it("is not offered while the chat is working, or in an empty chat", () => {
    expect(canRegenerate({ busy: true, lastRole: "assistant" })).toBe(false);
    expect(canRegenerate({ busy: true, lastRole: "user" })).toBe(false);
    expect(canRegenerate({ busy: false, lastRole: undefined })).toBe(false);
  });

  it("is not offered when the day's allowance is spent, since asking again cannot work", () => {
    expect(canRegenerate({ busy: false, lastRole: "user", dailyBudgetSpent: true })).toBe(false);
    expect(canRegenerate({ busy: false, lastRole: "assistant", dailyBudgetSpent: false })).toBe(
      true,
    );
  });
});

describe("messageLengthStatus", () => {
  it("says nothing for a short message", () => {
    expect(messageLengthStatus(0)).toEqual({ over: false, text: null });
    expect(messageLengthStatus(6_399)).toEqual({ over: false, text: null });
  });

  it("shows a counter from 80% of the limit, and still allows the message", () => {
    expect(messageLengthStatus(6_400)).toEqual({ over: false, text: "6,400 / 8,000 characters" });
    expect(messageLengthStatus(8_000)).toEqual({ over: false, text: "8,000 / 8,000 characters" });
  });

  it("says a message over the limit is too long and blocks it, instead of cutting it", () => {
    expect(messageLengthStatus(9_000)).toEqual({
      over: true,
      text: "9,000 / 8,000 characters. Shorten it to send.",
    });
  });

  it("takes another limit when given one", () => {
    expect(messageLengthStatus(11, 10).over).toBe(true);
  });
});
