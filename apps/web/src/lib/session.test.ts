import { describe, expect, it } from "vitest";
import { getSessionWorldId, WORLD_COOKIE, worldCookie } from "./session";
import { DEFAULT_WORLD_ID } from "./worlds";

const withCookie = (cookie?: string) =>
  new Request("http://localhost/api/chat", cookie ? { headers: { cookie } } : {});

describe("getSessionWorldId", () => {
  it("reads a known world from the cookie, among other cookies", () => {
    expect(getSessionWorldId(withCookie(`a=1; ${WORLD_COOKIE}=world_nox; b=2`))).toBe("world_nox");
  });

  it("falls back to the default world when there is no cookie", () => {
    expect(getSessionWorldId(withCookie())).toBe(DEFAULT_WORLD_ID);
  });

  it("falls back to the default for a world that does not exist", () => {
    expect(getSessionWorldId(withCookie(`${WORLD_COOKIE}=world_missing`))).toBe(DEFAULT_WORLD_ID);
    expect(getSessionWorldId(withCookie(`${WORLD_COOKIE}='; drop table lore_chunks`))).toBe(
      DEFAULT_WORLD_ID,
    );
  });

  it("falls back to the default for a cookie that is not valid percent-encoding", () => {
    expect(getSessionWorldId(withCookie(`${WORLD_COOKIE}=%E0%A4%A`))).toBe(DEFAULT_WORLD_ID);
  });
});

describe("worldCookie", () => {
  it("is HttpOnly and SameSite=Lax, and Secure only when asked", () => {
    const local = worldCookie("world_nox", false);
    expect(local).toContain(`${WORLD_COOKIE}=world_nox`);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).not.toContain("Secure");
    expect(worldCookie("world_nox", true)).toContain("Secure");
  });
});
