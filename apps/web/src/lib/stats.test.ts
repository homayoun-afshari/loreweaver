import { describe, expect, it } from "vitest";
import { mean, percentile } from "./stats";

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

describe("percentile", () => {
  it("uses nearest rank: p50 of 1..100 is 50, p95 is 95", () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 100)).toBe(100);
  });

  it("does not need sorted input and does not modify it", () => {
    const input = [30, 10, 20];
    expect(percentile(input, 50)).toBe(20);
    expect(input).toEqual([30, 10, 20]);
  });

  it("handles a single sample and rejects an empty list", () => {
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow();
  });
});

describe("mean", () => {
  it("averages the samples", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});
