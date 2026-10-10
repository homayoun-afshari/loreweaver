import { describe, expect, it } from "vitest";
import { MAX_MESSAGES, parseChatRequest } from "./chat-request";

const message = { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] };

describe("parseChatRequest", () => {
  it("accepts a normal request", () => {
    expect(parseChatRequest({ messages: [message] })?.messages).toHaveLength(1);
  });

  it("keeps an optional model", () => {
    expect(parseChatRequest({ messages: [message], model: "claude-haiku-4-5" })?.model).toBe(
      "claude-haiku-4-5",
    );
  });

  it("rejects a body without messages", () => {
    expect(parseChatRequest({})).toBeNull();
    expect(parseChatRequest({ messages: [] })).toBeNull();
    expect(parseChatRequest(null)).toBeNull();
  });

  it("rejects too many messages", () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => message);
    expect(parseChatRequest({ messages: many })).toBeNull();
  });

  it("rejects an oversized request", () => {
    const huge = { ...message, parts: [{ type: "text", text: "x".repeat(50_000) }] };
    expect(parseChatRequest({ messages: [huge] })).toBeNull();
  });
});
