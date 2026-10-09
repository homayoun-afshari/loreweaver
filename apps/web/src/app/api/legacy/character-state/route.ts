import { z } from "zod";

/**
 * Quick version of the legacy system: a dev-mode fallback that returns already-clean data
 * from memory. The real, production-shaped version is services/legacy-cms.
 * The character ids match the legacy service's seed data.
 */
const CHARACTERS = {
  "1": {
    location: "Ice Citadel",
    inventory: ["flint", "broken sword", "health potion"],
    mana_level: 20,
  },
  "2": { location: "Ember Keep", inventory: ["war hammer", "iron ration"], mana_level: 0 },
  "3": {
    location: "Glass Library",
    inventory: ["spellbook", "silver key", "ink vial"],
    mana_level: 75,
  },
  "4": { location: "Hollow Mine", inventory: ["lantern", "cracked mask"], mana_level: 40 },
  "5": { location: "Salt Harbour", inventory: ["star chart"], mana_level: 100 },
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

  const character = CHARACTERS[parsed.data.character_id as keyof typeof CHARACTERS];
  if (!character) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  return Response.json(character);
}
