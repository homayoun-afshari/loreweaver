type State = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. */
  failureThreshold?: number;
  /** How long the breaker stays open before letting one trial request through. */
  cooldownMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * Stops calling a dependency that keeps failing, so we fail instantly instead of waiting
 * for timeouts, and the struggling service gets room to recover.
 *
 * closed    -> normal; failures are counted.
 * open      -> calls are rejected immediately until the cooldown has passed.
 * half-open -> one trial call is allowed: success closes the breaker, failure re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor({
    failureThreshold = 5,
    cooldownMs = 30_000,
    now = Date.now,
  }: CircuitBreakerOptions = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  get state(): State {
    if (this.failures < this.failureThreshold) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  /** Call before each request. False means: don't even try. */
  canRequest(): boolean {
    const state = this.state;
    if (state === "closed") return true;
    if (state === "open") return false;
    // half-open: let exactly one trial through
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.failures += 1;
    this.trialInFlight = false;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }
}
