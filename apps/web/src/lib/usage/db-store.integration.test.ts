import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { usageEvents } from "@/db/schema";
import { createDbUsageStore } from "./db-store";
import { createUsageGuard } from "./guard";

/**
 * The usage store against a REAL Postgres: the numbers that the two limits are decided on come
 * from its queries, so they are checked on the real table and not on a fake. It needs a migrated
 * database in TEST_DATABASE_URL (locally the Docker one; in CI a Postgres service) and writes
 * only rows of its own random visitors, which it removes afterwards. Never point it at a shared
 * or hosted database.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("the usage store (real Postgres)", () => {
  const client = postgres(url ?? "postgres://unused", { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  const store = createDbUsageStore(db as never);
  const visitors: string[] = [];
  const newVisitor = () => {
    const id = `test-visitor-${randomUUID()}`;
    visitors.push(id);
    return id;
  };
  const request = (visitorId: string) => ({
    visitorId,
    worldId: "world_aethel",
    modelId: "claude-sonnet-5-5",
    promptVersion: "agent.v3",
  });
  const finished = (output: number) => ({
    status: "completed" as const,
    inputTokens: 100,
    cacheReadTokens: 50,
    cacheWriteTokens: 25,
    outputTokens: output,
    costUsd: 0.01,
    latencyMs: 1234,
  });

  afterAll(async () => {
    if (visitors.length)
      await db.delete(usageEvents).where(inArray(usageEvents.visitorId, visitors));
    await client.end();
  });

  it("records a request when it starts, so that it counts before it has finished", async () => {
    const visitor = newVisitor();
    const id = await store.start(request(visitor));

    const used = await store.consumption(visitor, new Date());
    expect(used.requestsInWindow).toBe(1);
    expect(used.tokensToday).toBe(0);
    expect(used.oldestRequestAt).toBeInstanceOf(Date);

    const [row] = await db.select().from(usageEvents).where(eq(usageEvents.id, id));
    expect(row).toMatchObject({ status: "started", latencyMs: null, costUsd: 0 });
  });

  it("adds every kind of token of the finished requests to the tokens of the day", async () => {
    const visitor = newVisitor();
    await store.finish(await store.start(request(visitor)), finished(40));
    await store.finish(await store.start(request(visitor)), finished(60));

    const used = await store.consumption(visitor, new Date());
    // Each: 100 input + 50 cache read + 25 cache write + the output.
    expect(used.tokensToday).toBe(215 + 235);
    expect(used.requestsInWindow).toBe(2);
  });

  it("counts a visitor's requests apart from another's", async () => {
    const a = newVisitor();
    const b = newVisitor();
    await store.start(request(a));
    await store.start(request(a));
    await store.start(request(b));

    expect((await store.consumption(a, new Date())).requestsInWindow).toBe(2);
    expect((await store.consumption(b, new Date())).requestsInWindow).toBe(1);
  });

  it("leaves a request older than a minute out of the window and yesterday's out of the day", async () => {
    const visitor = newVisitor();
    const now = new Date();
    const old = new Date(now.getTime() - 5 * 60_000);
    const yesterday = new Date(now.getTime() - 25 * 3_600_000);
    await db.insert(usageEvents).values([
      { ...request(visitor), createdAt: old, outputTokens: 70, status: "completed" },
      { ...request(visitor), createdAt: yesterday, outputTokens: 9999, status: "completed" },
    ]);

    const used = await store.consumption(visitor, now);
    expect(used.requestsInWindow).toBe(0);
    expect(used.oldestRequestAt).toBeNull();
    // Five minutes ago is today (unless the test runs in the first minutes after midnight UTC).
    const minutesIntoDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    expect(used.tokensToday).toBe(minutesIntoDay >= 6 ? 70 : used.tokensToday);
  });

  it("applies the limits through the guard on the real table", async () => {
    const visitor = newVisitor();
    const guard = createUsageGuard({
      store,
      limits: { requestsPerMinute: 2, dailyTokenBudget: 1_000_000 },
    });
    expect((await guard.begin(request(visitor))).decision.allowed).toBe(true);
    expect((await guard.begin(request(visitor))).decision.allowed).toBe(true);
    expect((await guard.begin(request(visitor))).decision).toMatchObject({
      allowed: false,
      reason: "rate",
    });

    const heavy = newVisitor();
    const budget = createUsageGuard({
      store,
      limits: { requestsPerMinute: 100, dailyTokenBudget: 300 },
    });
    const first = await budget.begin(request(heavy));
    await budget.finish(first.id, finished(125));
    expect((await budget.begin(request(heavy))).decision).toMatchObject({
      allowed: false,
      reason: "daily",
    });
  });
});
