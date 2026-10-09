import { getEnv } from "@/lib/env";
import { createLegacyClient, type LegacyClient } from "./client";

export type { CharacterState } from "./character-state";
export type { LegacyError, Result } from "./errors";

let client: LegacyClient | undefined;

/**
 * The app-wide legacy client. One shared instance, so its circuit breaker sees every call.
 * Server-side only: it reads the API key from the validated environment.
 */
export function getLegacyClient(): LegacyClient {
  client ??= createLegacyClient({
    baseUrl: getEnv().LEGACY_CMS_URL,
    apiKey: getEnv().LEGACY_CMS_API_KEY,
  });
  return client;
}
