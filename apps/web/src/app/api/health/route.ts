import { connection } from "next/server";

/**
 * Liveness check for the web app. It deliberately does NOT call the legacy CMS:
 * "the web app is up" and "the CMS is up" are separate questions.
 */
export async function GET(): Promise<Response> {
  // Wait for a real request, so this runs on every call (not once at build time)
  // and proves the server is actually running.
  await connection();

  return Response.json({
    status: "ok",
    service: "web",
    // Set by Vercel: "production", "preview" or (locally) unset.
    environment: process.env.VERCEL_ENV ?? "development",
    // Short git commit of this deployment, so I can tell which version is live.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  });
}
