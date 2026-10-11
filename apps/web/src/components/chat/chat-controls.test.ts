import { describe, expect, it } from "vitest";
import { canRegenerate } from "./chat-controls";

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
