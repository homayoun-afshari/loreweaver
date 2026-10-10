import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * A database client for command-line scripts (ingestion, the retrieval eval). The app's own
 * client (index.ts) reads the whole validated environment, which scripts do not need. This one
 * takes just the connection string and must be closed when the script is done.
 * Same settings as the app: Supabase's pooled connection has no prepared statements.
 */
export function createStandaloneDb(url: string) {
  const client = postgres(url, { prepare: false, max: 1 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
