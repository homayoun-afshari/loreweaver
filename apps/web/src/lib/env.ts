import { z } from "zod";

/**
 * Every environment variable the server needs, with its expected shape.
 * Add new variables here (and to .env.example) on the day that needs them.
 */
const envSchema = z.object({
  /** Base URL of the legacy CMS service. */
  LEGACY_CMS_URL: z.url(),
  /** API key sent to the legacy CMS in the X-API-Key header. */
  LEGACY_CMS_API_KEY: z.string().min(1),
  /** Anthropic API key for model calls (dev key locally and in Preview, prod key in Production). */
  ANTHROPIC_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/** Validates a set of variables. Throws one readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${problems}\nSee .env.example and copy it to .env.local.`,
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** The validated environment for this process. Server-side only. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
