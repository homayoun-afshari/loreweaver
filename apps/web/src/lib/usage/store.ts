import type { Consumption } from "./limits";

/** What is known when a chat request starts. */
export type UsageStart = {
  visitorId: string;
  worldId: string;
  modelId: string;
  promptVersion: string;
};

/** What is known when it ends. `inputTokens` leaves out the cached tokens, which are listed apart. */
export type UsageFinish = {
  status: "completed" | "failed";
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

/** Where the usage of the visitors is kept: the Postgres table `usage_events`, or a fake in tests. */
export interface UsageStore {
  /** What a visitor has used in the last minute and since the start of the UTC day. */
  consumption(visitorId: string, now: Date): Promise<Consumption>;
  /** Records a request that starts, with no tokens yet. Returns its id. */
  start(row: UsageStart): Promise<string>;
  /** Records what the request used. */
  finish(id: string, result: UsageFinish): Promise<void>;
}
