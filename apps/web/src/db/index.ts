import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * One database client per server process. In development, Next.js reloads modules often,
 * so the client is kept on `globalThis` to avoid opening a new connection pool each time.
 */
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

function getClient() {
  globalForDb.pgClient ??= postgres(getEnv().DATABASE_URL, {
    // Supabase's pooled ("transaction") connection does not support prepared statements.
    prepare: false,
    // A serverless function handles one request at a time, so one connection is enough.
    max: 1,
  });
  return globalForDb.pgClient;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
