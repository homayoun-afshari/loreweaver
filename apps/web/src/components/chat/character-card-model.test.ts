import { describe, expect, it } from "vitest";
import {
  describeLegacyError,
  formatUpdatedAt,
  locationLabel,
  statPercent,
} from "./character-card-model";

describe("statPercent", () => {
  it("maps a 0 to 100 stat to a bar width", () => {
    expect(statPercent(0)).toBe(0);
    expect(statPercent(40)).toBe(40);
    expect(statPercent(100)).toBe(100);
  });

  it("clamps values outside the scale and ignores bad numbers", () => {
    expect(statPercent(250)).toBe(100);
    expect(statPercent(-5)).toBe(0);
    expect(statPercent(Number.NaN)).toBe(0);
  });
});

describe("locationLabel", () => {
  it("shows the place name", () => {
    expect(locationLabel({ code: 22, name: "Hollow Mine" })).toBe("Hollow Mine");
  });

  it("never invents a name for an unknown code", () => {
    expect(locationLabel({ code: 99, name: null })).toBe("Unknown location (code 99)");
  });
});

describe("formatUpdatedAt", () => {
  it("formats in UTC with a fixed locale", () => {
    expect(formatUpdatedAt("2026-10-09T11:15:00.000Z")).toBe("9 Oct 2026, 11:15 UTC");
  });

  it("copes with a bad date", () => {
    expect(formatUpdatedAt("nonsense")).toBe("unknown");
  });
});

describe("describeLegacyError", () => {
  it("warns that unavailable state may be stale", () => {
    const error = {
      kind: "unavailable",
      reason: "circuit_open",
      stale: true,
      message: "x",
    } as const;
    expect(describeLegacyError(error).detail).toMatch(/out of date/);
  });

  it("does not leak internal messages", () => {
    const result = describeLegacyError({
      kind: "invalid_response",
      message: "secret schema detail",
    });
    expect(JSON.stringify(result)).not.toMatch(/secret/);
  });
});
