import { RATE_WINDOW_MS, startOfUtcDay, type Consumption } from "./limits";
import type { UsageFinish, UsageStart, UsageStore } from "./store";

export type MemoryRow = UsageStart & {
  id: string;
  createdAt: Date;
  finished?: UsageFinish;
};

/**
 * A usage store in memory, for tests. It answers like the database one: the requests of the last
 * minute and the tokens since the start of the UTC day, for one visitor.
 */
export function memoryUsageStore(now: () => Date = () => new Date()) {
  const rows: MemoryRow[] = [];
  const store: UsageStore = {
    async consumption(visitorId: string, at: Date): Promise<Consumption> {
      const own = rows.filter((r) => r.visitorId === visitorId);
      const inWindow = own.filter((r) => r.createdAt.getTime() >= at.getTime() - RATE_WINDOW_MS);
      const today = own.filter((r) => r.createdAt >= startOfUtcDay(at));
      const tokens = (r: MemoryRow) =>
        r.finished
          ? r.finished.inputTokens +
            r.finished.cacheReadTokens +
            r.finished.cacheWriteTokens +
            r.finished.outputTokens
          : 0;
      return {
        requestsInWindow: inWindow.length,
        oldestRequestAt: inWindow.length
          ? new Date(Math.min(...inWindow.map((r) => r.createdAt.getTime())))
          : null,
        tokensToday: today.reduce((sum, r) => sum + tokens(r), 0),
      };
    },
    async start(row: UsageStart): Promise<string> {
      const id = `usage-${rows.length + 1}`;
      rows.push({ ...row, id, createdAt: now() });
      return id;
    },
    async finish(id: string, result: UsageFinish): Promise<void> {
      const row = rows.find((r) => r.id === id);
      if (row) row.finished = result;
    },
  };
  return { store, rows };
}

/** A finished request that used this many tokens, all of them output tokens. */
export const finishedWith = (tokens: number): UsageFinish => ({
  status: "completed",
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: tokens,
  costUsd: 0,
  latencyMs: 1000,
});
