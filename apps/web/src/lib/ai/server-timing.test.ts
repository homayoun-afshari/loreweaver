import { describe, expect, it } from "vitest";
import { createChatTimer } from "./server-timing";

/** A fake clock that the test moves by hand, so the numbers are exact. */
function fakeClock() {
  let time = 1000;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("createChatTimer", () => {
  it("measures the first tool call and the first text token separately", () => {
    const clock = fakeClock();
    const timer = createChatTimer(clock.now);

    clock.advance(900);
    timer.markChunk("tool-input-start");
    clock.advance(1500);
    timer.markChunk("text-delta");
    clock.advance(300);

    expect(timer.snapshot()).toEqual({
      serverFirstUiMs: 900,
      serverTtftMs: 2400,
      serverTotalMs: 2700,
    });
  });

  it("counts a tool call that arrives whole as the first UI, like one that streams in", () => {
    const clock = fakeClock();
    const timer = createChatTimer(clock.now);

    clock.advance(1200);
    timer.markChunk("tool-input-available");
    clock.advance(800);
    timer.markChunk("tool-input-available");

    expect(timer.snapshot().serverFirstUiMs).toBe(1200);
  });

  it("keeps the first moment, not the last", () => {
    const clock = fakeClock();
    const timer = createChatTimer(clock.now);

    clock.advance(500);
    timer.markChunk("text-delta");
    clock.advance(500);
    timer.markChunk("text-delta");

    expect(timer.snapshot().serverTtftMs).toBe(500);
  });

  it("leaves a value empty when that kind of chunk never came", () => {
    const clock = fakeClock();
    const timer = createChatTimer(clock.now);
    clock.advance(200);
    timer.markChunk("text-delta");

    expect(timer.snapshot().serverFirstUiMs).toBeUndefined();
  });
});
