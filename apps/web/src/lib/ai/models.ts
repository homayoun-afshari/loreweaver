/**
 * The models the app may call, with their prices. One place to change a model.
 * Prices are USD per million tokens (input / output), from the Day 2 guide.
 */
export const MODELS = {
  "claude-haiku-4-5": { label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
} as const;

export type ModelId = keyof typeof MODELS;

/** Cheap and fast: used for development and as the fallback everywhere. */
export const DEFAULT_MODEL_ID: ModelId = "claude-haiku-4-5";

export function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && Object.hasOwn(MODELS, value);
}

/**
 * Picks the model for one request. A caller may ask for a specific model (the benchmark does),
 * but only from the allowlist, and never in production: a public visitor must not be able
 * to pick the expensive model.
 */
export function resolveModelId(requested: unknown, vercelEnv: string | undefined): ModelId {
  if (vercelEnv === "production") return DEFAULT_MODEL_ID;
  return isModelId(requested) ? requested : DEFAULT_MODEL_ID;
}

/** Cost in USD of one call. */
export function costUsd(modelId: ModelId, inputTokens: number, outputTokens: number): number {
  const m = MODELS[modelId];
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}
