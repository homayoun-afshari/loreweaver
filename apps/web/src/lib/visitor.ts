/**
 * The "visitor" of the app, as far as consumption limits are concerned.
 *
 * There is no sign-in, so a visitor is a random id that the server hands out in a cookie that
 * only the server can read (HttpOnly), like the world in session.ts. It is NOT an account and
 * not a security boundary: a visitor who clears their cookies gets a new id and a new allowance.
 * It is enough to stop a browser tab, a script or a runaway client from spending without bound.
 * When real sign-in exists, the account id replaces it here.
 */
export const VISITOR_COOKIE = "lw_visitor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The visitor of this request. A missing or malformed cookie gets a new id, and `isNew` tells the
 * caller to send the cookie, so the next request is recognized.
 */
export function getVisitor(request: Request): { id: string; isNew: boolean } {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VISITOR_COOKIE && UUID.test(rest.join("="))) {
      return { id: rest.join("=").toLowerCase(), isNew: false };
    }
  }
  return { id: crypto.randomUUID(), isNew: true };
}

/** The Set-Cookie header value that remembers a visitor for a year. */
export function visitorCookie(visitorId: string, secure: boolean): string {
  return [
    `${VISITOR_COOKIE}=${visitorId}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly", // JavaScript in the page cannot read or change it.
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
