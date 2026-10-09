import { describe, expect, it } from "vitest";
import { GET } from "./route";

const call = (query: string) =>
  GET(new Request(`http://localhost/api/legacy/character-state${query}`));

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
