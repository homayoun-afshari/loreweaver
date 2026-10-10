import { z } from "zod";
import { getSessionWorldId, worldCookie } from "@/lib/session";
import { isKnownWorld, KNOWN_WORLDS } from "@/lib/worlds";

const bodySchema = z.object({ worldId: z.string() });

/** Which world this visitor is in, and which worlds exist. */
export async function GET(request: Request): Promise<Response> {
  return Response.json({
    worldId: getSessionWorldId(request),
    worlds: KNOWN_WORLDS.map(({ id, label }) => ({ id, label })),
  });
}

/** Remembers the visitor's world in a cookie. Only known worlds are accepted. */
export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !isKnownWorld(body.data.worldId)) {
    return Response.json({ error: "Unknown world." }, { status: 400 });
  }
  // The cookie is Secure whenever the app is deployed (HTTPS); plain http://localhost cannot use it.
  const secure = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production";
  return Response.json(
    { worldId: body.data.worldId },
    { headers: { "Set-Cookie": worldCookie(body.data.worldId, secure) } },
  );
}
