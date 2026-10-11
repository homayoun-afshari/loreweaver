/**
 * The consumption limits of one visitor, and the decision that applies them. Pure functions: the
 * numbers come in, so the rule is tested without a database or a clock.
 */

export type Limits = {
  /** The most chat requests one visitor may start in any 60 seconds. */
  requestsPerMinute: number;
  /** The most tokens (all kinds, all model calls) one visitor may spend in one UTC day. */
  dailyTokenBudget: number;
};

/** A person cannot send ten messages a minute; a script can. 200,000 tokens is about 20 answers. */
export const DEFAULT_LIMITS: Limits = { requestsPerMinute: 10, dailyTokenBudget: 200_000 };

export const RATE_WINDOW_MS = 60_000;

/** What the visitor has used so far, as the usage table says. */
export type Consumption = {
  /** Requests started in the last minute. */
  requestsInWindow: number;
  /** When the oldest of them started, or null when there is none. */
  oldestRequestAt: Date | null;
  /** Tokens spent since the start of the UTC day. */
  tokensToday: number;
};

export type LimitReason = "rate" | "daily";

export type Decision =
  { allowed: true } | { allowed: false; reason: LimitReason; retryAfterSeconds: number };

/** The start of the UTC day that contains `now`: the budget counts from here. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Seconds until the budget starts again, at the next midnight UTC. */
export function secondsUntilNextUtcDay(now: Date): number {
  const next = startOfUtcDay(now).getTime() + 24 * 3_600_000;
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Applies both limits. The daily budget is checked first: when it is spent, waiting a minute does
 * not help, and the message has to say so. The rate limit lets a request through when the number
 * of earlier requests in the window is below the limit.
 */
export function decide(used: Consumption, limits: Limits, now: Date): Decision {
  if (used.tokensToday >= limits.dailyTokenBudget) {
    return { allowed: false, reason: "daily", retryAfterSeconds: secondsUntilNextUtcDay(now) };
  }
  if (used.requestsInWindow >= limits.requestsPerMinute) {
    const oldest = used.oldestRequestAt?.getTime() ?? now.getTime();
    const wait = Math.ceil((oldest + RATE_WINDOW_MS - now.getTime()) / 1000);
    return { allowed: false, reason: "rate", retryAfterSeconds: Math.max(1, wait) };
  }
  return { allowed: true };
}

/** What the visitor is told. The chat shows it as it is. */
export function limitMessage(reason: LimitReason, retryAfterSeconds: number): string {
  if (reason === "daily") {
    return "You have used today's allowance of answers. It starts again at midnight UTC.";
  }
  return `You are sending messages quickly. Please wait ${retryAfterSeconds} seconds and try again.`;
}
