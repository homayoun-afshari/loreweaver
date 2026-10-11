import { describe, expect, it } from "vitest";
import { getVisitor, VISITOR_COOKIE, visitorCookie } from "./visitor";

const id = "3f2b8c1e-9a4d-4e57-8c3b-1d2e3f4a5b6c";
const request = (cookie?: string) =>
  new Request("http://localhost/api/chat", { headers: cookie ? { cookie } : {} });

describe("getVisitor", () => {
  it("recognizes the visitor of the cookie", () => {
    expect(getVisitor(request(`lw_world=world_nox; ${VISITOR_COOKIE}=${id}`))).toEqual({
      id,
      isNew: false,
    });
  });

  it("gives a new id to a request with no cookie", () => {
    const visitor = getVisitor(request());
    expect(visitor.isNew).toBe(true);
    expect(visitor.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["", "nope", "12345", `${id}extra`, "../../etc/passwd"])(
    "does not trust the cookie value %j",
    (value) => {
      const visitor = getVisitor(request(`${VISITOR_COOKIE}=${value}`));
      expect(visitor.isNew).toBe(true);
      expect(visitor.id).not.toBe(value);
    },
  );

  it("gives a different id each time there is no cookie", () => {
    expect(getVisitor(request()).id).not.toBe(getVisitor(request()).id);
  });
});

describe("visitorCookie", () => {
  it("is HttpOnly, for a year, and Secure when deployed", () => {
    const cookie = visitorCookie(id, true);
    expect(cookie).toContain(`${VISITOR_COOKIE}=${id}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("Secure");
    expect(visitorCookie(id, false)).not.toContain("Secure");
  });
});
