import { describe, expect, it } from "vitest";
import { addUsage, noUsage, tokensOfReply } from "./state";

describe("tokensOfReply", () => {
  it("reads the tokens that LangChain puts on a reply, with the cached ones apart", () => {
    expect(
      tokensOfReply({
        input_tokens: 5000,
        output_tokens: 120,
        input_token_details: { cache_read: 1843, cache_creation: 200 },
      }),
    ).toEqual({ input: 5000, output: 120, cacheRead: 1843, cacheWrite: 200 });
  });

  it("copes with a reply that has no usage, or no cache details", () => {
    expect(tokensOfReply(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(tokensOfReply({ input_tokens: 10, output_tokens: 2 })).toEqual({
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe("addUsage", () => {
  it("adds every kind of token of the drafting and the checking apart", () => {
    const a = {
      agent: { input: 100, output: 10, cacheRead: 40, cacheWrite: 5 },
      reflection: { input: 20, output: 2, cacheRead: 0, cacheWrite: 0 },
    };
    const b = {
      agent: { input: 300, output: 30, cacheRead: 60, cacheWrite: 0 },
      reflection: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0 },
    };
    expect(addUsage(a, b)).toEqual({
      agent: { input: 400, output: 40, cacheRead: 100, cacheWrite: 5 },
      reflection: { input: 70, output: 7, cacheRead: 0, cacheWrite: 0 },
    });
    expect(addUsage(noUsage(), a)).toEqual(a);
  });
});
