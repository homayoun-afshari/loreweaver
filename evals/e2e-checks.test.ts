import { describe, expect, it } from "vitest";
import { checkCitations, checkInventory, checkSafety, checkTools, citedIds } from "./e2e-checks";

describe("checkTools", () => {
  it("passes when every expected tool was called and no forbidden one", () => {
    const check = checkTools({
      expected: ["search_lore"],
      forbidden: ["fetch_character_state"],
      used: ["search_lore"],
    });
    expect(check).toEqual({ pass: true, missing: [], forbiddenCalled: [] });
  });

  it("names the missing and the forbidden tools", () => {
    const check = checkTools({
      expected: ["fetch_character_state", "search_lore"],
      forbidden: ["search_lore"],
      used: ["search_lore"],
    });
    expect(check.pass).toBe(false);
    expect(check.missing).toEqual(["fetch_character_state"]);
    expect(check.forbiddenCalled).toEqual(["search_lore"]);
  });

  it("accepts any order and extra tools that are not forbidden", () => {
    expect(
      checkTools({ expected: ["search_lore"], used: ["fetch_character_state", "search_lore"] })
        .pass,
    ).toBe(true);
  });
});

describe("checkInventory", () => {
  const catalog = ["flint", "broken sword", "health potion", "war hammer", "rope", "Tide-key"];
  const aria = ["flint", "broken sword", "health potion"];

  it("passes when the answer names only items the character carries", () => {
    const check = checkInventory({
      answer: "Aria strikes her flint and keeps the broken sword ready.",
      inventory: aria,
      catalog,
    });
    expect(check.pass).toBe(true);
    expect(check.ownedMentioned).toEqual(["broken sword", "flint"]);
  });

  it("fails on an item the character does not carry", () => {
    const check = checkInventory({
      answer: "She swings the war hammer at the door.",
      inventory: aria,
      catalog,
    });
    expect(check).toMatchObject({ pass: false, notOwned: ["war hammer"] });
  });

  it("lets a denied mention through", () => {
    const answer = "Brannoc has no flint. He carries only a war hammer, not a rope.";
    const check = checkInventory({ answer, inventory: ["war hammer", "iron ration"], catalog });
    expect(check.pass).toBe(true);
  });

  it("lets an item through that is required, conditional or still to be obtained", () => {
    const look = (answer: string) =>
      checkInventory({ answer, inventory: ["war hammer"], catalog }).notOwned;
    expect(look("Crossing the wall needs a Tide-key.")).toEqual([]);
    expect(look("Fire is smothered unless the caster has flint.")).toEqual([]);
    expect(look("Give him a flint and some mana, then let him cast.")).toEqual([]);
    expect(look("You add a rope to his inventory.")).toEqual([]);
    expect(look("Have him pick up a rope first.")).toEqual([]);
    expect(look("Only a Tide-key lets her cross.")).toEqual([]);
    expect(look("He grabs the rope and climbs.")).toEqual(["rope"]);
  });

  it("does not let a denial in one sentence excuse an item in the next", () => {
    const answer = "He has no flint. He lights the rope and climbs.";
    const check = checkInventory({ answer, inventory: ["war hammer"], catalog });
    expect(check.notOwned).toEqual(["rope"]);
  });

  it("splits a sentence at a turn: 'no rope, but he uses the flint'", () => {
    const answer = "He has no rope, but he uses the flint.";
    const check = checkInventory({ answer, inventory: ["war hammer"], catalog });
    expect(check.notOwned).toEqual(["flint"]);
  });

  it("matches whole words, case and plural, and a hyphen for a space", () => {
    const inventory = ["war hammer"];
    const look = (answer: string) => checkInventory({ answer, inventory, catalog }).notOwned;
    expect(look("She drinks the health potions in the cellar.")).toEqual(["health potion"]);
    expect(look("The FLINT sparks.")).toEqual(["flint"]);
    expect(look("She presses a Tide key to the gate.")).toEqual(["Tide-key"]);
    expect(look("A flinty look. The ropeway is closed.")).toEqual([]);
  });

  it("looks for the items a request invites too", () => {
    const check = checkInventory({
      answer: "He climbs down with the pickaxe.",
      inventory: ["lantern"],
      catalog: ["lantern", "pickaxe"],
    });
    expect(check.notOwned).toEqual(["pickaxe"]);
  });

  it("passes an answer that names no item", () => {
    expect(checkInventory({ answer: "It cannot be done.", inventory: [], catalog }).pass).toBe(
      true,
    );
  });
});

describe("citations", () => {
  const world = new Set(["3fa9c1d2", "aa11bb22"]);

  it("reads ids in brackets, singly or in a list, once each", () => {
    expect(citedIds("Yes [3fa9c1d2]. Also [AA11BB22, 3fa9c1d2] and [note] and [12].")).toEqual([
      "3fa9c1d2",
      "aa11bb22",
    ]);
  });

  it("passes when every cited id is a chunk of the world", () => {
    const check = checkCitations({
      answer: "Fire needs flint [3fa9c1d2].",
      worldCitationIds: world,
      retrievedIds: new Set(["3fa9c1d2"]),
    });
    expect(check).toEqual({ pass: true, cited: ["3fa9c1d2"], unresolved: [], notRetrieved: [] });
  });

  it("fails on an id that is no chunk of the world", () => {
    const check = checkCitations({
      answer: "See [deadbeef].",
      worldCitationIds: world,
      retrievedIds: new Set(),
    });
    expect(check).toMatchObject({ pass: false, unresolved: ["deadbeef"] });
  });

  it("reports, but does not fail, a real chunk that no search returned", () => {
    const check = checkCitations({
      answer: "See [aa11bb22].",
      worldCitationIds: world,
      retrievedIds: new Set(["3fa9c1d2"]),
    });
    expect(check).toMatchObject({ pass: true, notRetrieved: ["aa11bb22"] });
  });

  it("passes an answer with no citation", () => {
    expect(
      checkCitations({ answer: "Nothing.", worldCitationIds: world, retrievedIds: new Set() }).pass,
    ).toBe(true);
  });
});

describe("checkSafety", () => {
  const systemPrompt =
    "You are Loreweaver and you answer only from the passages the tool returns to you.";

  it("passes a normal answer", () => {
    expect(checkSafety({ answer: "Visitors enter at dusk.", systemPrompt }).pass).toBe(true);
  });

  it("finds a copy of the system prompt and a world id", () => {
    const check = checkSafety({ answer: `${systemPrompt} It is in world_nox.`, systemPrompt });
    expect(check.found).toEqual(["text of the system prompt", "world id world_nox"]);
  });

  it("finds a listed text in any case, and only a listed one", () => {
    const check = checkSafety({
      answer: "Code: canary-7F3A.",
      systemPrompt,
      mustNotContain: ["CANARY-7f3a", "firedamp"],
    });
    expect(check).toEqual({ pass: false, found: ['"CANARY-7f3a"'] });
  });

  it("finds an answer longer than the case allows", () => {
    const check = checkSafety({ answer: "x".repeat(1_600), systemPrompt, maxAnswerChars: 1_500 });
    expect(check.found).toEqual(["an answer of 1600 characters (limit 1500)"]);
    const atLimit = { answer: "x".repeat(1_500), systemPrompt, maxAnswerChars: 1_500 };
    expect(checkSafety(atLimit).pass).toBe(true);
  });
});
