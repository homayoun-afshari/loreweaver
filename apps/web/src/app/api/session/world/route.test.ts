import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/session/world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("GET /api/session/world", () => {
  it("returns the current world and the list of worlds", async () => {
    const response = await GET(
      new Request("http://localhost/api/session/world", {
        headers: { cookie: "lw_world=world_nox" },
      }),
    );
    const data = await response.json();
    expect(data.worldId).toBe("world_nox");
    expect(data.worlds.map((w: { id: string }) => w.id)).toEqual(["world_aethel", "world_nox"]);
  });
});

describe("POST /api/session/world", () => {
  it("remembers a known world in an HttpOnly cookie", async () => {
    const response = await post({ worldId: "world_nox" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^lw_world=world_nox;.*HttpOnly/);
  });

  it("rejects an unknown world, a bad body and broken JSON, and sets no cookie", async () => {
    for (const body of [{ worldId: "world_missing" }, { nope: 1 }, "{not json"]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
