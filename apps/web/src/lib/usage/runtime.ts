import { getDb } from "@/db";
import { getEnv } from "@/lib/env";
import { createDbUsageStore } from "./db-store";
import { createUsageGuard, type UsageGuard } from "./guard";

let guard: UsageGuard | undefined;

/**
 * The usage guard with the real database and the limits of the environment. One per process.
 * Server-side only.
 */
export function getUsageGuard(): UsageGuard {
  guard ??= createUsageGuard({
    store: createDbUsageStore(getDb()),
    limits: {
      requestsPerMinute: getEnv().RATE_LIMIT_PER_MINUTE,
      dailyTokenBudget: getEnv().DAILY_TOKEN_BUDGET,
    },
  });
  return guard;
}
