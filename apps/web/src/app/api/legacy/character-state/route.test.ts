import { describe, expect, it } from "vitest";
import { GET } from "./route";

const call = (query: string, world?: string) =>
  GET(
    new Request(`http://localhost/api/legacy/character-state${query}`, {
      headers: world ? { cookie: `lw_world=${world}` } : {},
    }),
  );

describe("GET /api/legacy/character-state", () => {
  it("returns the character's state", async () => {
    const res = call("?character_id=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: "Ice Citadel",
      inventory: ["flint", "broken sword", "health potion"],
      mana_level: 20,
    });
  });

  it("returns 400 when character_id is missing or not a number", async () => {
    expect(call("").status).toBe(400);
    expect(call("?character_id=abc").status).toBe(400);
  });

  it("returns 404 for an unknown character", () => {
    expect(call("?character_id=99").status).toBe(404);
  });
});

describe("the fallback is limited to the session's world", () => {
  it("serves a character only in the world it belongs to", () => {
    expect(call("?character_id=1", "world_aethel").status).toBe(200);
    expect(call("?character_id=4", "world_nox").status).toBe(200);
    // Another world's character is a plain 404, the same as one that does not exist.
    expect(call("?character_id=4", "world_aethel").status).toBe(404);
    expect(call("?character_id=1", "world_nox").status).toBe(404);
  });

  it("uses the default world (Aethel) when there is no cookie, and never returns the world id", async () => {
    expect(call("?character_id=4").status).toBe(404);
    expect(await call("?character_id=1").json()).not.toHaveProperty("worldId");
  });
});
