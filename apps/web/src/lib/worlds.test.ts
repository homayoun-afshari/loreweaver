import { describe, expect, it } from "vitest";
import { charactersOf, DEFAULT_WORLD_ID, isKnownWorld, KNOWN_WORLDS } from "./worlds";

describe("worlds", () => {
  it("knows its worlds, and the default is one of them", () => {
    expect(KNOWN_WORLDS.map((w) => w.id)).toEqual(["world_aethel", "world_nox"]);
    expect(isKnownWorld(DEFAULT_WORLD_ID)).toBe(true);
    expect(isKnownWorld("world_missing")).toBe(false);
    expect(isKnownWorld(undefined)).toBe(false);
  });

  it("gives each world its own characters, and none to an unknown world", () => {
    expect(charactersOf("world_aethel").map((c) => c.id)).toEqual([1, 2, 3]);
    expect(charactersOf("world_nox").map((c) => c.id)).toEqual([4, 5]);
    expect(charactersOf("world_missing")).toEqual([]);
  });

  it("never gives the same character to two worlds", () => {
    const ids = KNOWN_WORLDS.flatMap((w) => w.characters.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
