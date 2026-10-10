import { z } from "zod";

/** The database settings. Used by the app and by the ingestion script. */
const databaseShape = {
  /** Postgres connection string: local Docker in development, Supabase (pooled) in Preview and Production. */
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
};

/** The embedding settings. Used by the app (to embed a question) and by the ingestion script. */
const embeddingShape = {
  /** Voyage AI API key (dev key locally and in Preview, prod key in Production). */
  VOYAGE_API_KEY: z.string().min(1),
  /** Embedding model name. Chunks and queries must use the same one, so changing it means re-ingesting. */
  EMBEDDING_MODEL: z.string().min(1),
};

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
  ...databaseShape,
  ...embeddingShape,
});

/** What `pnpm ingest` needs: no model key and no legacy CMS, so it can run without them. */
const ingestEnvSchema = z.object({ ...databaseShape, ...embeddingShape });

export type Env = z.infer<typeof envSchema>;
export type IngestEnv = z.infer<typeof ingestEnvSchema>;

function parseWith<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${problems}\nSee .env.example and copy it to .env.local.`,
    );
  }
  return result.data as z.infer<T>;
}

/** Validates a set of variables. Throws one readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(envSchema, source);
}

/** Same, for the smaller set that the ingestion script needs. */
export function parseIngestEnv(source: Record<string, string | undefined>): IngestEnv {
  return parseWith(ingestEnvSchema, source);
}

let cached: Env | undefined;

/** The validated environment for this process. Server-side only. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
