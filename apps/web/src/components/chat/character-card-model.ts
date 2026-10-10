import type { CharacterState, LegacyError } from "@/lib/legacy";

/** The legacy CMS has no maximum for mana or health. Seed data uses a 0 to 100 scale. */
export const STAT_MAX = 100;

/** Width of a stat bar, 0 to 100, clamped so a bad value cannot overflow the bar. */
export function statPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round((value / STAT_MAX) * 100)));
}

/** Never guess a place: an unknown location code is shown as such. */
export function locationLabel(location: CharacterState["location"]): string {
  return location.name ?? `Unknown location (code ${location.code})`;
}

/** "9 Oct 2026, 11:15 UTC". Fixed locale and zone, so the text is the same for every viewer. */
export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const text = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${text} UTC`;
}

/** A short message for the error card. Internal details are never shown. */
export function describeLegacyError(error: LegacyError): { title: string; detail: string } {
  switch (error.kind) {
    case "unavailable":
      return {
        title: "Character service unavailable",
        detail: "The live state could not be read, so anything shown earlier may be out of date.",
      };
    case "not_found":
      return { title: "Character not found", detail: "No character matches that id." };
    default:
      return { title: "Could not read character state", detail: "Please try again later." };
  }
}
