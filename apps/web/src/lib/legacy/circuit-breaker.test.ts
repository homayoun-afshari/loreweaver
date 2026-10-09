import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuit-breaker";

function setup() {
  let time = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => time });
  return { breaker, advance: (ms: number) => (time += ms) };
}

describe("CircuitBreaker", () => {
  it("stays closed below the failure threshold", () => {
    const { breaker } = setup();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
    expect(breaker.canRequest()).toBe(true);
  });

  it("opens after consecutive failures and rejects calls", () => {
    const { breaker } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.state).toBe("open");
    expect(breaker.canRequest()).toBe(false);
  });

  it("a success resets the failure count", () => {
    const { breaker } = setup();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
  });

  it("lets exactly one trial through after the cooldown (half-open)", () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    expect(breaker.state).toBe("half-open");
    expect(breaker.canRequest()).toBe(true);
    expect(breaker.canRequest()).toBe(false); // second caller waits for the trial result
  });

  it("closes again when the trial succeeds", () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    breaker.canRequest();
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
  });

  it("re-opens for a full cooldown when the trial fails", () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    breaker.canRequest();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
    advance(999);
    expect(breaker.state).toBe("open");
    advance(1);
    expect(breaker.state).toBe("half-open");
  });
});
