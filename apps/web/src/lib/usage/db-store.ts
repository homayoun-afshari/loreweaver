import { eq, sql } from "drizzle-orm";
import { usageEvents } from "@/db/schema";
import { RATE_WINDOW_MS, startOfUtcDay, type Consumption } from "./limits";
import type { UsageFinish, UsageStart, UsageStore } from "./store";

/** The database client, as far as this store needs it (the real one, or one made for a test). */
type Db = ReturnType<typeof import("@/db").getDb>;

/** The usage store on the Postgres table `usage_events`. Server-side only. */
export function createDbUsageStore(db: Db): UsageStore {
  return {
    async consumption(visitorId: string, now: Date): Promise<Consumption> {
      // Moments go to the database as ISO text with an explicit type: a Date inside a raw `sql`
      // fragment is refused by the driver (found by the test on a real Postgres).
      const windowStartDate = new Date(now.getTime() - RATE_WINDOW_MS);
      const dayStartDate = startOfUtcDay(now);
      const windowStart = windowStartDate.toISOString();
      const dayStart = dayStartDate.toISOString();
      // Both counts come from one query over the rows since the earlier of the two moments.
      const since = windowStartDate < dayStartDate ? windowStart : dayStart;
      const createdAt = usageEvents.createdAt;
      const rows = await db
        .select({
          requestsInWindow: sql<number>`count(*) filter (where ${createdAt} >= ${windowStart}::timestamptz)`,
          oldestInWindow: sql<
            string | null
          >`min(${createdAt}) filter (where ${createdAt} >= ${windowStart}::timestamptz)`,
          tokensToday: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.cacheReadTokens} + ${usageEvents.cacheWriteTokens} + ${usageEvents.outputTokens}) filter (where ${createdAt} >= ${dayStart}::timestamptz), 0)`,
        })
        .from(usageEvents)
        .where(
          sql`${usageEvents.visitorId} = ${visitorId} and ${createdAt} >= ${since}::timestamptz`,
        );
      const row = rows[0];
      return {
        requestsInWindow: Number(row?.requestsInWindow ?? 0),
        oldestRequestAt: row?.oldestInWindow ? new Date(row.oldestInWindow) : null,
        tokensToday: Number(row?.tokensToday ?? 0),
      };
    },

    async start(row: UsageStart): Promise<string> {
      const [created] = await db.insert(usageEvents).values(row).returning({ id: usageEvents.id });
      return created.id;
    },

    async finish(id: string, result: UsageFinish): Promise<void> {
      await db.update(usageEvents).set(result).where(eq(usageEvents.id, id));
    },
  };
}
