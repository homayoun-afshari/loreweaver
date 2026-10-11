import { z } from "zod";
import { locationName } from "./locations";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Legacy dates look like "09-OCT-26 14:32" (no time zone; we treat them as UTC). */
export function parseLegacyDate(value: string): string | null {
  const match = /^(\d{2})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]);
  if (month === -1) return null;
  const date = new Date(
    Date.UTC(2000 + Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5])),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The raw shape the legacy CMS returns (see openapi.yaml), validated and converted in one step.
 * This is the anti-corruption layer: everything odd about the legacy system is handled here,
 * and the rest of the app only ever sees `CharacterState`.
 */
export const characterStateSchema = z
  .object({
    char_id: z.number().int(),
    char_name: z.string(),
    world_id: z.string(),
    loc_code: z.number().int(),
    inv_str: z.string(),
    status: z.object({
      mana_pts: z.string().regex(/^\d+$/), // zero-padded text, e.g. "020"
      hp_pts: z.string().regex(/^\d+$/),
      cond_flag: z.enum(["OK", "WND"]),
    }),
    last_upd: z.string().transform((value, ctx) => {
      const iso = parseLegacyDate(value);
      if (iso === null) {
        ctx.issues.push({
          code: "custom",
          message: `Unrecognized date format: ${value}`,
          input: value,
        });
        return z.NEVER;
      }
      return iso;
    }),
  })
  .transform((raw) => ({
    id: raw.char_id,
    name: raw.char_name,
    worldId: raw.world_id,
    location: { code: raw.loc_code, name: locationName(raw.loc_code) },
    // "flint,broken sword" -> ["flint", "broken sword"]; an empty string means no items.
    inventory: raw.inv_str
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
    mana: Number(raw.status.mana_pts),
    hp: Number(raw.status.hp_pts),
    condition: raw.status.cond_flag === "OK" ? ("healthy" as const) : ("wounded" as const),
    updatedAt: raw.last_upd, // ISO 8601, UTC
  }));

/** The clean domain model the rest of the app uses. */
export type CharacterState = z.output<typeof characterStateSchema>;
