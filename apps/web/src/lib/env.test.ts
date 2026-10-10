import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  LEGACY_CMS_URL: "http://localhost:8080",
  LEGACY_CMS_API_KEY: "dev-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
};

describe("parseEnv", () => {
  it("returns typed values when everything is present", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("fails fast and names every missing variable", () => {
    expect(() => parseEnv({})).toThrow(/LEGACY_CMS_URL/);
    expect(() => parseEnv({})).toThrow(/LEGACY_CMS_API_KEY/);
    expect(() => parseEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, LEGACY_CMS_URL: "not-a-url" })).toThrow(/LEGACY_CMS_URL/);
  });

  it("rejects a database URL that is not a postgres URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an empty API key", () => {
    expect(() => parseEnv({ ...valid, LEGACY_CMS_API_KEY: "" })).toThrow(/LEGACY_CMS_API_KEY/);
  });
});
