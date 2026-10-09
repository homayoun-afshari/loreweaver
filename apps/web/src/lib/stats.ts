/**
 * Percentile by the "nearest rank" method: the smallest value such that at least `p` percent
 * of the samples are less than or equal to it. p95 = 95% of requests were this fast or faster.
 */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile of an empty list");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function mean(samples: number[]): number {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}
