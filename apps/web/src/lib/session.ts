import { DEFAULT_WORLD_ID, isKnownWorld } from "./worlds";

/**
 * The "session" of the app, as far as lore search is concerned: which world the visitor is in.
 *
 * There is no sign-in yet, so this is a stand-in. The world is kept in a cookie that only the
 * server can read (HttpOnly), checked against the list of known worlds, and falls back to the
 * default. It is NOT authentication: any visitor can pick any known world. What it does give us
 * is the right place for the rule that matters: the world is decided HERE, on the server, from
 * the request. It never comes from the model. When real sign-in exists, only this file changes.
 */
export const WORLD_COOKIE = "lw_world";

/** The world of this request. Unknown or malformed values fall back to the default world. */
export function getSessionWorldId(request: Request): string {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== WORLD_COOKIE) continue;
    try {
      const value = decodeURIComponent(rest.join("="));
      return isKnownWorld(value) ? value : DEFAULT_WORLD_ID;
    } catch {
      return DEFAULT_WORLD_ID; // A cookie with broken percent-encoding.
    }
  }
  return DEFAULT_WORLD_ID;
}

/** The Set-Cookie header value that remembers a world for a year. */
export function worldCookie(worldId: string, secure: boolean): string {
  return [
    `${WORLD_COOKIE}=${encodeURIComponent(worldId)}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly", // JavaScript in the page cannot read or change it.
    "SameSite=Lax", // Not sent with requests started from other sites.
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
