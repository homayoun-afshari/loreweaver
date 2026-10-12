import { describe, expect, it } from "vitest";
import {
  isMessageTooLong,
  MAX_MESSAGES,
  MAX_USER_MESSAGE_CHARS,
  parseChatRequest,
} from "./chat-request";

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

  it("rejects a new message longer than the limit, and accepts one at the limit", () => {
    const text = (n: number) => ({ ...message, parts: [{ type: "text", text: "x".repeat(n) }] });
    expect(parseChatRequest({ messages: [text(MAX_USER_MESSAGE_CHARS)] })).not.toBeNull();
    expect(parseChatRequest({ messages: [text(MAX_USER_MESSAGE_CHARS + 1)] })).toBeNull();
  });

  it("counts the text of all the parts of the message, and only text", () => {
    const half = "x".repeat(MAX_USER_MESSAGE_CHARS / 2 + 1);
    const two = {
      ...message,
      parts: [
        { type: "text", text: half },
        { type: "text", text: half },
      ],
    };
    expect(parseChatRequest({ messages: [two] })).toBeNull();
    const withTool = {
      ...message,
      parts: [
        { type: "text", text: "hi" },
        { type: "tool-search_lore", output: "y".repeat(9_000) },
      ],
    };
    expect(parseChatRequest({ messages: [withTool] })).not.toBeNull();
  });

  it("limits the newest message only: a long answer in the history is not the author's input", () => {
    const answer = {
      id: "2",
      role: "assistant",
      parts: [{ type: "text", text: "a".repeat(MAX_USER_MESSAGE_CHARS + 1_000) }],
    };
    expect(parseChatRequest({ messages: [message, answer, message] })).not.toBeNull();
  });
});

describe("isMessageTooLong", () => {
  const text = (n: number) => ({ ...message, parts: [{ type: "text", text: "x".repeat(n) }] });

  it("is true for a request refused only because the newest message is too long", () => {
    const body = { messages: [text(MAX_USER_MESSAGE_CHARS + 1)] };
    expect(parseChatRequest(body)).toBeNull();
    expect(isMessageTooLong(body)).toBe(true);
  });

  it("is true even when the message is also over the size of a whole request", () => {
    expect(isMessageTooLong({ messages: [text(50_000)] })).toBe(true);
  });

  it("is false for a message at the limit and for the other reasons a request is refused", () => {
    expect(isMessageTooLong({ messages: [text(MAX_USER_MESSAGE_CHARS)] })).toBe(false);
    expect(isMessageTooLong({ messages: [] })).toBe(false);
    expect(isMessageTooLong({})).toBe(false);
    expect(isMessageTooLong(null)).toBe(false);
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => text(MAX_USER_MESSAGE_CHARS + 1));
    expect(isMessageTooLong({ messages: many })).toBe(false);
  });
});
