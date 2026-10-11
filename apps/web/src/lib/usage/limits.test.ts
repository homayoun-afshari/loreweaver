import { describe, expect, it } from "vitest";
import {
  decide,
  DEFAULT_LIMITS,
  limitMessage,
  secondsUntilNextUtcDay,
  startOfUtcDay,
  type Consumption,
} from "./limits";

const limits = { requestsPerMinute: 3, dailyTokenBudget: 1000 };
const now = new Date("2026-10-11T18:30:00Z");
const used = (over: Partial<Consumption> = {}): Consumption => ({
  requestsInWindow: 0,
  oldestRequestAt: null,
  tokensToday: 0,
  ...over,
});

describe("decide: the rate limit", () => {
  it("lets a request through while the visitor is below the limit", () => {
    const oldest = new Date(now.getTime() - 20_000);
    expect(decide(used({ requestsInWindow: 2, oldestRequestAt: oldest }), limits, now)).toEqual({
      allowed: true,
    });
  });

  it("refuses the request that would be over the limit, and says when to try again", () => {
    // The oldest of the three requests started 20 s ago, so it leaves the window in 40 s.
    const oldest = new Date(now.getTime() - 20_000);
    expect(decide(used({ requestsInWindow: 3, oldestRequestAt: oldest }), limits, now)).toEqual({
      allowed: false,
      reason: "rate",
      retryAfterSeconds: 40,
    });
  });

  it("never asks to wait less than a second", () => {
    const oldest = new Date(now.getTime() - 59_900);
    const decision = decide(used({ requestsInWindow: 3, oldestRequestAt: oldest }), limits, now);
    expect(decision).toMatchObject({ allowed: false, reason: "rate", retryAfterSeconds: 1 });
  });
});

describe("decide: the daily token budget", () => {
  it("lets a request through while tokens are left", () => {
    expect(decide(used({ tokensToday: 999 }), limits, now)).toEqual({ allowed: true });
  });

  it("refuses once the budget is spent, until the next UTC midnight", () => {
    // 18:30 UTC: 5 h 30 min to midnight.
    expect(decide(used({ tokensToday: 1000 }), limits, now)).toEqual({
      allowed: false,
      reason: "daily",
      retryAfterSeconds: 5.5 * 3600,
    });
  });

  it("is checked before the rate limit, because waiting a minute would not help", () => {
    const decision = decide(
      used({ tokensToday: 5000, requestsInWindow: 9, oldestRequestAt: now }),
      limits,
      now,
    );
    expect(decision).toMatchObject({ allowed: false, reason: "daily" });
  });
});

describe("the UTC day", () => {
  it("starts at midnight UTC", () => {
    expect(startOfUtcDay(now).toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("counts the seconds to the next midnight, and at least one", () => {
    expect(secondsUntilNextUtcDay(new Date("2026-10-11T23:59:59.500Z"))).toBe(1);
    expect(secondsUntilNextUtcDay(new Date("2026-10-11T00:00:00Z"))).toBe(86_400);
  });
});

describe("limitMessage", () => {
  it("tells a visitor who is too fast how long to wait", () => {
    expect(limitMessage("rate", 40)).toContain("40 seconds");
  });

  it("tells a visitor whose day is spent when it starts again", () => {
    expect(limitMessage("daily", 1000)).toContain("midnight UTC");
  });
});

describe("the defaults", () => {
  it("are 10 requests a minute and 200,000 tokens a day", () => {
    expect(DEFAULT_LIMITS).toEqual({ requestsPerMinute: 10, dailyTokenBudget: 200_000 });
  });
});
