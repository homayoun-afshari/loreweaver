/** Legacy numeric location codes, as documented in services/legacy-cms/openapi.yaml. */
const LOCATION_NAMES: Record<number, string> = {
  3: "Salt Harbour",
  4: "Ember Keep",
  9: "Glass Library",
  17: "Ice Citadel",
  22: "Hollow Mine",
};

/** Returns the place name, or null for a code we don't know (never guess a location). */
export function locationName(code: number): string | null {
  return LOCATION_NAMES[code] ?? null;
}
