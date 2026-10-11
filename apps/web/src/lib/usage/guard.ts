import type { Usage } from "@/lib/agent/state";
import { REFLECTION_MODEL_ID, tokensCostUsd, type ModelId } from "@/lib/ai/models";
import { decide, type Decision, type Limits } from "./limits";
import type { UsageFinish, UsageStart, UsageStore } from "./store";

/** What the route does with the usage of a request: ask before it runs, report after. */
export type UsageGuard = {
  /**
   * Applies the limits to a visitor and, when the request may run, records that it started.
   * `id` is what `finish` needs; it is missing when the store could not be used.
   */
  begin(request: UsageStart): Promise<{ decision: Decision; id?: string }>;
  /** Records what a request used. Never throws: the answer must not depend on bookkeeping. */
  finish(id: string | undefined, result: UsageFinish): Promise<void>;
};

/**
 * The guard on a store. When the store fails (the database is down) the request is let through
 * and the failure is logged: a pre-launch chat that stops because of its own bookkeeping is worse
 * than a few unmetered answers. The limits do not hold during such an outage.
 */
export function createUsageGuard(deps: {
  store: UsageStore;
  limits: Limits;
  now?: () => Date;
}): UsageGuard {
  const now = deps.now ?? (() => new Date());
  return {
    async begin(request) {
      try {
        const used = await deps.store.consumption(request.visitorId, now());
        const decision = decide(used, deps.limits, now());
        if (!decision.allowed) return { decision };
        return { decision, id: await deps.store.start(request) };
      } catch (error) {
        console.error("[usage] could not check the limits", error);
        return { decision: { allowed: true } };
      }
    },
    async finish(id, result) {
      if (!id) return;
      try {
        await deps.store.finish(id, result);
      } catch (error) {
        console.error("[usage] could not record the usage", error);
      }
    },
  };
}

/**
 * What a finished (or failed) run used, as the row of the usage table: the tokens of the drafting
 * and checking models together, and their cost by each model's own prices.
 */
export function usageFinish(args: {
  usage: Usage;
  agentModel: ModelId;
  latencyMs: number;
  status: UsageFinish["status"];
}): UsageFinish {
  const { agent, reflection } = args.usage;
  const cacheRead = agent.cacheRead + reflection.cacheRead;
  const cacheWrite = agent.cacheWrite + reflection.cacheWrite;
  return {
    status: args.status,
    inputTokens: agent.input + reflection.input - cacheRead - cacheWrite,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: agent.output + reflection.output,
    costUsd: tokensCostUsd(args.agentModel, agent) + tokensCostUsd(REFLECTION_MODEL_ID, reflection),
    latencyMs: Math.round(args.latencyMs),
  };
}
