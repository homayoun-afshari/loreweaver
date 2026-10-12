import { describe, expect, it } from "vitest";
import { parseLimitError, parseTooLongError } from "./limit-error";

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    error: "rate_limited",
    message: "You are sending messages quickly. Please wait 12 seconds and try again.",
    retryAfterSeconds: 12,
    ...over,
  });

describe("parseLimitError", () => {
  it("reads a rate limit and a daily budget answer of the route", () => {
    expect(parseLimitError(body())).toMatchObject({ error: "rate_limited", retryAfterSeconds: 12 });
    expect(parseLimitError(body({ error: "daily_budget" }))?.error).toBe("daily_budget");
  });

  it.each([
    ["nothing", undefined],
    ["a plain error message", "Failed to fetch"],
    ["another JSON answer", JSON.stringify({ error: "Invalid request." })],
    ["an unknown kind", body({ error: "other" })],
    ["no message", body({ message: "" })],
    ["a wait that is not a number", body({ retryAfterSeconds: "soon" })],
  ])("returns null for %s", (_name, text) => {
    expect(parseLimitError(text)).toBeNull();
  });
});

describe("parseTooLongError", () => {
  const tooLong = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      error: "message_too_long",
      message: "Your message is too long: the limit is 8,000 characters.",
      maxChars: 8000,
      ...over,
    });

  it("reads the answer of the route to a message that is too long", () => {
    expect(parseTooLongError(tooLong())).toMatchObject({
      error: "message_too_long",
      maxChars: 8000,
    });
  });

  it.each([
    ["nothing", undefined],
    ["a plain error message", "Failed to fetch"],
    ["the generic invalid request", JSON.stringify({ error: "Invalid request." })],
    [
      "a rate limit",
      JSON.stringify({ error: "rate_limited", message: "Wait.", retryAfterSeconds: 3 }),
    ],
    ["no message", tooLong({ message: "" })],
    ["a limit that is not a number", tooLong({ maxChars: "many" })],
  ])("returns null for %s", (_name, text) => {
    expect(parseTooLongError(text)).toBeNull();
  });

  it("is not mistaken for a rate limit, and a rate limit is not mistaken for it", () => {
    expect(parseLimitError(tooLong())).toBeNull();
  });
});
