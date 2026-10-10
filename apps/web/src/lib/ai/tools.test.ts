import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import type { CharacterState } from "@/lib/legacy";
import type { LegacyClient } from "@/lib/legacy/client";
import type { SearchLoreOutput } from "@/lib/rag/search-types";
import { createTools, type ToolDeps } from "./tools";

const kael: CharacterState = {
  id: 4,
  name: "Kael Draven",
  worldId: "world_nox",
  location: { code: 22, name: "Hollow Mine" },
  inventory: ["lantern", "cracked mask"],
  mana: 40,
  hp: 90,
  condition: "healthy",
  updatedAt: "2026-10-09T11:15:00.000Z",
};

function run(client: Pick<LegacyClient, "getCharacterState">, characterId: string) {
  const tools = createTools({ worldId: "world_nox", getClient: () => client as LegacyClient });
  const execute = tools.fetch_character_state.execute!;
  // The SDK passes call metadata (ids, messages) that this tool does not use, so a stub is enough.
  return execute({ character_id: characterId }, {
    toolCallId: "t1",
    messages: [],
  } as never) as Promise<unknown>;
}

describe("fetch_character_state", () => {
  it("returns the clean character state from the legacy client", async () => {
    const getCharacterState = vi.fn().mockResolvedValue({ ok: true, value: kael });
    await expect(run({ getCharacterState }, "4")).resolves.toEqual({ ok: true, character: kael });
    expect(getCharacterState).toHaveBeenCalledWith(4);
  });

  it("passes a legacy error through as data", async () => {
    const error = {
      kind: "unavailable",
      reason: "timeout",
      stale: true,
      message: "Character service unavailable; state may be stale.",
    };
    const getCharacterState = vi.fn().mockResolvedValue({ ok: false, error });
    await expect(run({ getCharacterState }, "4")).resolves.toEqual({ ok: false, error });
  });

  it("rejects a non-numeric id without calling the CMS", async () => {
    const getCharacterState = vi.fn();
    const result = await run({ getCharacterState }, "Kael");
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(getCharacterState).not.toHaveBeenCalled();
  });
});

const callMeta = { toolCallId: "t1", messages: [] } as never;

describe("search_lore", () => {
  const found: SearchLoreOutput = {
    ok: true,
    hits: [
      {
        citationId: "3fa9c1d2",
        sourcePath: "data/lore/world_aethel/magic-system.md",
        headingPath: "The Magic of Aethel > Casting Rules > Teleportation",
        docType: "rule",
        content: "Teleportation costs 50 mana and cannot cross warded walls.",
        similarity: 0.71,
      },
    ],
  };

  function lore(searchLore: ReturnType<typeof vi.fn>, worldId = "world_aethel") {
    return createTools({ worldId, searchLore: searchLore as ToolDeps["searchLore"] });
  }

  it("searches the world of the session, with the model's query and k", async () => {
    const searchLore = vi.fn().mockResolvedValue(found);
    const result = await lore(searchLore).search_lore.execute!(
      { query: "teleport cost", k: 2 },
      callMeta,
    );
    expect(result).toEqual(found);
    expect(searchLore).toHaveBeenCalledWith({
      worldId: "world_aethel",
      query: "teleport cost",
      k: 2,
    });
  });

  it("never lets the model choose the world", async () => {
    const searchLore = vi.fn().mockResolvedValue(found);
    const tools = lore(searchLore, "world_aethel");

    // 1. The schema the model sees has no world field at all.
    const shown = z.toJSONSchema(tools.search_lore.inputSchema as z.ZodType) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(shown.properties).sort()).toEqual(["k", "query"]);

    // 2. A world the model sends anyway is removed by the schema, before the tool runs.
    const parsed = (tools.search_lore.inputSchema as z.ZodType).parse({
      query: "teleport",
      world_id: "world_nox",
      worldId: "world_nox",
    });
    expect(parsed).toEqual({ query: "teleport" });

    // 3. And even if the raw object reached the tool, only the session's world is used.
    await tools.search_lore.execute!(
      { query: "teleport", world_id: "world_nox", worldId: "world_nox" } as never,
      callMeta,
    );
    expect(searchLore).toHaveBeenLastCalledWith(
      expect.objectContaining({ worldId: "world_aethel" }),
    );
  });

  it("rejects an empty or very long query, and a k outside 1 to 8", () => {
    const schema = lore(vi.fn()).search_lore.inputSchema as z.ZodType;
    expect(schema.safeParse({ query: "" }).success).toBe(false);
    expect(schema.safeParse({ query: "x".repeat(501) }).success).toBe(false);
    expect(schema.safeParse({ query: "ok", k: 0 }).success).toBe(false);
    expect(schema.safeParse({ query: "ok", k: 9 }).success).toBe(false);
    expect(schema.safeParse({ query: "ok", k: 3 }).success).toBe(true);
  });

  it("passes a search failure through as data", async () => {
    const failure: SearchLoreOutput = {
      ok: false,
      error: { kind: "unavailable", message: "Lore search is unavailable right now." },
    };
    const result = await lore(vi.fn().mockResolvedValue(failure)).search_lore.execute!(
      { query: "x" },
      callMeta,
    );
    expect(result).toEqual(failure);
  });
});

describe("fetch_character_state is limited to the session's world", () => {
  const aria: CharacterState = {
    ...kael,
    id: 1,
    name: "Aria Voss",
    worldId: "world_aethel",
    location: { code: 17, name: "Ice Citadel" },
  };

  function inWorld(worldId: string, getCharacterState: ReturnType<typeof vi.fn>, id: string) {
    const tools = createTools({
      worldId,
      getClient: () => ({ getCharacterState }) as unknown as LegacyClient,
    });
    return tools.fetch_character_state.execute!({ character_id: id }, callMeta);
  }

  it("returns a character of the session's world", async () => {
    const getCharacterState = vi.fn().mockResolvedValue({ ok: true, value: aria });
    await expect(inWorld("world_aethel", getCharacterState, "1")).resolves.toEqual({
      ok: true,
      character: aria,
    });
  });

  it("hides a character of another world: the same answer as a character that does not exist", async () => {
    // The CMS knows every world, so it happily returns Aria. The tool must not pass her on.
    const exists = vi.fn().mockResolvedValue({ ok: true, value: aria });
    const missing = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: "not_found", message: "Character not found." },
    });
    const fromOtherWorld = await inWorld("world_nox", exists, "1");
    const reallyMissing = await inWorld("world_nox", missing, "99");

    expect(fromOtherWorld).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Character not found." },
    });
    // Indistinguishable: nothing in the answer reveals that character 1 exists elsewhere.
    expect(fromOtherWorld).toEqual(reallyMissing);
    expect(JSON.stringify(fromOtherWorld)).not.toMatch(/aria|aethel|ice citadel/i);
  });
});
