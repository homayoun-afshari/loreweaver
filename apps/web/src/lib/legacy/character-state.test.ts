import { describe, expect, it } from "vitest";
import { characterStateSchema, parseLegacyDate } from "./character-state";

// A response exactly as the legacy CMS sends it (see services/legacy-cms/openapi.yaml).
const raw = {
  char_id: 1,
  char_name: "Aria Voss",
  world_id: "world_aethel",
  loc_code: 17,
  inv_str: "flint,broken sword,health potion",
  status: { mana_pts: "020", hp_pts: "085", cond_flag: "OK" },
  last_upd: "09-OCT-26 14:32",
};

describe("characterStateSchema (legacy -> domain mapping)", () => {
  it("maps legacy fields to the clean CharacterState model", () => {
    expect(characterStateSchema.parse(raw)).toEqual({
      id: 1,
      name: "Aria Voss",
      worldId: "world_aethel",
      location: { code: 17, name: "Ice Citadel" },
      inventory: ["flint", "broken sword", "health potion"],
      mana: 20,
      hp: 85,
      condition: "healthy",
      updatedAt: "2026-10-09T14:32:00.000Z",
    });
  });

  it("casts zero-padded text numbers to numbers", () => {
    const state = characterStateSchema.parse({
      ...raw,
      status: { ...raw.status, mana_pts: "000" },
    });
    expect(state.mana).toBe(0);
  });

  it("maps WND to wounded", () => {
    const state = characterStateSchema.parse({
      ...raw,
      status: { ...raw.status, cond_flag: "WND" },
    });
    expect(state.condition).toBe("wounded");
  });

  it("turns an empty inventory string into an empty list and trims items", () => {
    expect(characterStateSchema.parse({ ...raw, inv_str: "" }).inventory).toEqual([]);
    expect(characterStateSchema.parse({ ...raw, inv_str: " flint , ,key" }).inventory).toEqual([
      "flint",
      "key",
    ]);
  });

  it("keeps an unknown location code but gives it no name", () => {
    const state = characterStateSchema.parse({ ...raw, loc_code: 99 });
    expect(state.location).toEqual({ code: 99, name: null });
  });

  it("rejects responses that break the contract", () => {
    expect(characterStateSchema.safeParse({ ...raw, loc_code: "17" }).success).toBe(false);
    expect(characterStateSchema.safeParse({ ...raw, status: undefined }).success).toBe(false);
    expect(
      characterStateSchema.safeParse({ ...raw, status: { ...raw.status, mana_pts: "abc" } })
        .success,
    ).toBe(false);
    expect(characterStateSchema.safeParse({ ...raw, last_upd: "yesterday" }).success).toBe(false);
  });
});

describe("parseLegacyDate", () => {
  it("parses DD-MON-YY HH:MM as UTC", () => {
    expect(parseLegacyDate("06-OCT-26 17:20")).toBe("2026-10-06T17:20:00.000Z");
  });

  it("returns null for unknown formats or months", () => {
    expect(parseLegacyDate("2026-10-06")).toBeNull();
    expect(parseLegacyDate("06-XXX-26 17:20")).toBeNull();
  });
});
