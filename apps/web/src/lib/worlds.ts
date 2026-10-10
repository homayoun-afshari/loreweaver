/**
 * The worlds the app knows about. Plain constants, so both the server and the browser can import
 * this file. The ids are the same ones the legacy CMS uses, and the names of the folders in data/lore.
 *
 * Stand-in: a real product would take the list from the signed-in author's account.
 */
export const KNOWN_WORLDS = [
  {
    id: "world_aethel",
    label: "Aethel",
    characters: [
      { id: 1, name: "Aria Voss" },
      { id: 2, name: "Brannoc Hale" },
      { id: 3, name: "Sera Quill" },
    ],
  },
  {
    id: "world_nox",
    label: "Nox",
    characters: [
      { id: 4, name: "Kael Draven" },
      { id: 5, name: "Mira Sol" },
    ],
  },
] as const;

export type KnownWorldId = (typeof KNOWN_WORLDS)[number]["id"];

/** The world used when the visitor has not chosen one. */
export const DEFAULT_WORLD_ID: KnownWorldId = "world_aethel";

/**
 * The characters of one world, as a stand-in until the chat can look characters up (the ids are
 * those of the legacy CMS). Unknown world: none. Only ever used with the session's world, so one
 * world's characters are never put in front of the model in another world's chat.
 */
export function charactersOf(worldId: string): readonly { id: number; name: string }[] {
  return KNOWN_WORLDS.find((world) => world.id === worldId)?.characters ?? [];
}

export function isKnownWorld(value: unknown): value is KnownWorldId {
  return KNOWN_WORLDS.some((world) => world.id === value);
}
