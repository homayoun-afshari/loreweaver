import { z } from "zod";
import { getSessionWorldId } from "@/lib/session";

/**
 * Quick version of the legacy system: a dev-mode fallback that returns already-clean data
 * from memory. The real, production-shaped version is services/legacy-cms.
 * The character ids match the legacy service's seed data.
 */
const CHARACTERS = {
  "1": {
    worldId: "world_aethel",
    location: "Ice Citadel",
    inventory: ["flint", "broken sword", "health potion"],
    mana_level: 20,
  },
  "2": {
    worldId: "world_aethel",
    location: "Ember Keep",
    inventory: ["war hammer", "iron ration"],
    mana_level: 0,
  },
  "3": {
    worldId: "world_aethel",
    location: "Glass Library",
    inventory: ["spellbook", "silver key", "ink vial"],
    mana_level: 75,
  },
  "4": {
    worldId: "world_nox",
    location: "Hollow Mine",
    inventory: ["lantern", "cracked mask"],
    mana_level: 40,
  },
  "5": {
    worldId: "world_nox",
    location: "Salt Harbour",
    inventory: ["star chart"],
    mana_level: 100,
  },
} as const;

const querySchema = z.object({ character_id: z.string().regex(/^\d+$/) });

export function GET(request: Request): Response {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "character_id is required and must be a number." },
      { status: 400 },
    );
  }

  const found = CHARACTERS[parsed.data.character_id as keyof typeof CHARACTERS];
  // A character of another world looks exactly like one that does not exist.
  if (!found || found.worldId !== getSessionWorldId(request)) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  // The world id is only used for the check above; it is not part of the answer.
  return Response.json({
    location: found.location,
    inventory: found.inventory,
    mana_level: found.mana_level,
  });
}
