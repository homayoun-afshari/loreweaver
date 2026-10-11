import { describe, expect, it } from "vitest";
import { parseLimitError } from "./limit-error";

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
