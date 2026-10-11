import { afterEach, describe, expect, it, vi } from "vitest";
import { noUsage } from "@/lib/agent/state";
import { createUsageGuard, usageFinish } from "./guard";
import { finishedWith, memoryUsageStore } from "./testing";

const request = (visitorId: string) => ({
  visitorId,
  worldId: "world_aethel",
  modelId: "claude-sonnet-5-5",
  promptVersion: "agent.v3",
});

afterEach(() => vi.restoreAllMocks());

describe("the usage guard: the rate limit", () => {
  it("lets the requests of the limit through and refuses the next one", async () => {
    let clock = new Date("2026-10-11T12:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({
      store,
      limits: { requestsPerMinute: 3, dailyTokenBudget: 1_000_000 },
      now: () => clock,
    });

    for (let i = 0; i < 3; i++) {
      const { decision } = await guard.begin(request("v1"));
      expect(decision.allowed).toBe(true);
      clock = new Date(clock.getTime() + 1000);
    }
    const refused = await guard.begin(request("v1"));
    expect(refused.decision).toMatchObject({ allowed: false, reason: "rate" });
    // A refused request is not recorded, so asking again does not extend the wait.
    expect(refused.id).toBeUndefined();
  });

  it("lets the visitor ask again once the minute has passed", async () => {
    let clock = new Date("2026-10-11T12:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({
      store,
      limits: { requestsPerMinute: 1, dailyTokenBudget: 1_000_000 },
      now: () => clock,
    });
    await guard.begin(request("v1"));
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(false);

    clock = new Date(clock.getTime() + 61_000);
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(true);
  });

  it("counts each visitor apart", async () => {
    const clock = new Date("2026-10-11T12:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({
      store,
      limits: { requestsPerMinute: 1, dailyTokenBudget: 1_000_000 },
      now: () => clock,
    });
    await guard.begin(request("v1"));
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(false);
    expect((await guard.begin(request("v2"))).decision.allowed).toBe(true);
  });
});

describe("the usage guard: the daily token budget", () => {
  const limits = { requestsPerMinute: 100, dailyTokenBudget: 1000 };

  it("refuses a visitor whose tokens of the day reach the budget", async () => {
    const clock = new Date("2026-10-11T12:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({ store, limits, now: () => clock });

    const first = await guard.begin(request("v1"));
    await guard.finish(first.id, finishedWith(600));
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(true);

    const second = await guard.begin(request("v1"));
    await guard.finish(second.id, finishedWith(500));
    // 600 + 500 tokens: over the 1,000 of the day.
    const refused = await guard.begin(request("v1"));
    expect(refused.decision).toMatchObject({ allowed: false, reason: "daily" });
  });

  it("starts a new budget at the next UTC day", async () => {
    let clock = new Date("2026-10-11T23:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({ store, limits, now: () => clock });

    const first = await guard.begin(request("v1"));
    await guard.finish(first.id, finishedWith(1000));
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(false);

    clock = new Date("2026-10-12T00:00:01Z");
    expect((await guard.begin(request("v1"))).decision.allowed).toBe(true);
  });

  it("counts the cached tokens too", async () => {
    const clock = new Date("2026-10-11T12:00:00Z");
    const { store } = memoryUsageStore(() => clock);
    const guard = createUsageGuard({ store, limits, now: () => clock });

    const first = await guard.begin(request("v1"));
    await guard.finish(first.id, {
      ...finishedWith(0),
      inputTokens: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
    });
    expect((await guard.begin(request("v1"))).decision).toMatchObject({ reason: "daily" });
  });
});

describe("the usage guard: when the store fails", () => {
  it("lets the request through and logs the failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createUsageGuard({
      store: {
        consumption: async () => {
          throw new Error("database down");
        },
        start: async () => "x",
        finish: async () => {},
      },
      limits: { requestsPerMinute: 1, dailyTokenBudget: 1 },
    });

    const { decision, id } = await guard.begin(request("v1"));
    expect(decision).toEqual({ allowed: true });
    expect(id).toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it("does not throw when recording the usage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createUsageGuard({
      store: {
        consumption: async () => ({ requestsInWindow: 0, oldestRequestAt: null, tokensToday: 0 }),
        start: async () => "x",
        finish: async () => {
          throw new Error("database down");
        },
      },
      limits: { requestsPerMinute: 10, dailyTokenBudget: 1000 },
    });
    await expect(guard.finish("x", finishedWith(1))).resolves.toBeUndefined();
  });
});

describe("usageFinish", () => {
  it("adds up the two models, leaves the cached tokens out of the input and prices each model", () => {
    const usage = {
      agent: { input: 5000, output: 400, cacheRead: 1843, cacheWrite: 0 },
      reflection: { input: 2400, output: 80, cacheRead: 0, cacheWrite: 0 },
    };
    const result = usageFinish({
      usage,
      agentModel: "claude-sonnet-5-5",
      latencyMs: 4321.6,
      status: "completed",
    });
    expect(result).toMatchObject({
      status: "completed",
      inputTokens: 5000 + 2400 - 1843,
      cacheReadTokens: 1843,
      cacheWriteTokens: 0,
      outputTokens: 480,
      latencyMs: 4322,
    });
    // Sonnet: 3157 in at $2, 1843 read at $0.10, 400 out at $10. Haiku: 2400 in at $1, 80 out at $5.
    const sonnet = (3157 * 2 + 1843 * 0.1 + 400 * 10) / 1e6;
    const haiku = (2400 * 1 + 80 * 5) / 1e6;
    expect(result.costUsd).toBeCloseTo(sonnet + haiku, 8);
  });

  it("records a run that used nothing", () => {
    expect(
      usageFinish({
        usage: noUsage(),
        agentModel: "claude-haiku-4-5",
        latencyMs: 10,
        status: "failed",
      }),
    ).toMatchObject({ status: "failed", inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});
