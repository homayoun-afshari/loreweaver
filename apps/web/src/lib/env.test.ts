import { describe, expect, it } from "vitest";
import { parseEnv, parseIngestEnv } from "./env";

const valid = {
  LEGACY_CMS_URL: "http://localhost:8080",
  LEGACY_CMS_API_KEY: "dev-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  VOYAGE_API_KEY: "pa-test",
  EMBEDDING_MODEL: "voyage-4-lite",
};

describe("parseEnv", () => {
  it("returns typed values when everything is present", () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      AGENT_MAX_ITERATIONS: 2,
      RATE_LIMIT_PER_MINUTE: 10,
      DAILY_TOKEN_BUDGET: 200000,
    });
  });

  it("reads the revision limit when it is set, and defaults to 2", () => {
    expect(parseEnv({ ...valid, AGENT_MAX_ITERATIONS: "0" }).AGENT_MAX_ITERATIONS).toBe(0);
    expect(parseEnv({ ...valid, AGENT_MAX_ITERATIONS: "5" }).AGENT_MAX_ITERATIONS).toBe(5);
    expect(parseEnv(valid).AGENT_MAX_ITERATIONS).toBe(2);
  });

  it.each(["", "6", "-1", "2.5", "many"])("rejects the revision limit %j", (value) => {
    expect(() => parseEnv({ ...valid, AGENT_MAX_ITERATIONS: value })).toThrow(
      /AGENT_MAX_ITERATIONS/,
    );
  });

  it("reads the consumption limits when they are set, and defaults to 10 a minute and 200,000 tokens", () => {
    const set = parseEnv({ ...valid, RATE_LIMIT_PER_MINUTE: "3", DAILY_TOKEN_BUDGET: "50000" });
    expect(set.RATE_LIMIT_PER_MINUTE).toBe(3);
    expect(set.DAILY_TOKEN_BUDGET).toBe(50000);
    expect(parseEnv(valid).RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(parseEnv(valid).DAILY_TOKEN_BUDGET).toBe(200000);
  });

  it.each(["", "0", "-5", "1.5", "lots", "1e6"])("rejects the consumption limit %j", (value) => {
    expect(() => parseEnv({ ...valid, RATE_LIMIT_PER_MINUTE: value })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
    expect(() => parseEnv({ ...valid, DAILY_TOKEN_BUDGET: value })).toThrow(/DAILY_TOKEN_BUDGET/);
  });

  it("fails fast and names every missing variable", () => {
    expect(() => parseEnv({})).toThrow(/LEGACY_CMS_URL/);
    expect(() => parseEnv({})).toThrow(/LEGACY_CMS_API_KEY/);
    expect(() => parseEnv({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/VOYAGE_API_KEY/);
    expect(() => parseEnv({})).toThrow(/EMBEDDING_MODEL/);
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

describe("parseIngestEnv", () => {
  it("needs only the database and the embedding settings", () => {
    const env = parseIngestEnv({
      DATABASE_URL: valid.DATABASE_URL,
      VOYAGE_API_KEY: valid.VOYAGE_API_KEY,
      EMBEDDING_MODEL: valid.EMBEDDING_MODEL,
    });
    expect(env.EMBEDDING_MODEL).toBe("voyage-4-lite");
  });

  it("names what is missing", () => {
    expect(() => parseIngestEnv({})).toThrow(/VOYAGE_API_KEY/);
    expect(() => parseIngestEnv({})).toThrow(/DATABASE_URL/);
  });
});
