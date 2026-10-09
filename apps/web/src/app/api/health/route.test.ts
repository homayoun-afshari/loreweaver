import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// connection() only works inside a real Next.js request, so the test replaces it.
vi.mock("next/server", () => ({ connection: async () => {} }));

describe("GET /api/health", () => {
  it("reports that the web app is up", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "web" });
  });
});
