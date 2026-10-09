// Next.js calls register() once when the server starts, before it accepts requests.
// Validating the environment here makes the app fail at startup, not mid-request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/lib/env");
    getEnv();
  }
}
