/**
 * The models the app may call, with their prices. One place to change a model.
 * Prices are USD per million tokens (input / output), from the Day 2 guide.
 */
export const MODELS = {
  "claude-haiku-4-5": { label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
} as const;

export type ModelId = keyof typeof MODELS;

/** Cheap and fast: used on a developer's machine (ADR-0002). */
export const DEV_MODEL_ID: ModelId = "claude-haiku-4-5";

/** The model the agent uses in Preview and Production (ADR-0002). */
export const AGENT_MODEL_ID: ModelId = "claude-sonnet-5-5";

export function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && Object.hasOwn(MODELS, value);
}

/** VERCEL_ENV is "preview" or "production" in the cloud, and unset (or "development") locally. */
function isDeployed(vercelEnv: string | undefined): boolean {
  return vercelEnv === "preview" || vercelEnv === "production";
}

/** The model used when nobody asks for a specific one. */
export function defaultModelId(vercelEnv: string | undefined): ModelId {
  return isDeployed(vercelEnv) ? AGENT_MODEL_ID : DEV_MODEL_ID;
}

/**
 * Picks the model for one request. On a developer's machine a caller may ask for a specific
 * model (the benchmark does), but only from the allowlist. In Preview and Production the
 * request is ignored: a public visitor must not be able to pick the model, or its cost.
 */
export function resolveModelId(requested: unknown, vercelEnv: string | undefined): ModelId {
  if (isDeployed(vercelEnv)) return defaultModelId(vercelEnv);
  return isModelId(requested) ? requested : defaultModelId(vercelEnv);
}

/** Cost in USD of one call. */
export function costUsd(modelId: ModelId, inputTokens: number, outputTokens: number): number {
  const m = MODELS[modelId];
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}
