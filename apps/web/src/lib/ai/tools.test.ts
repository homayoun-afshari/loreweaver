import { describe, expect, it, vi } from "vitest";
import type { CharacterState } from "@/lib/legacy";
import type { LegacyClient } from "@/lib/legacy/client";
import { createTools } from "./tools";

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
  const tools = createTools(() => client as LegacyClient);
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
