import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./constants";
import { embeddingCostUsd, embedTexts } from "./embeddings";

const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => seed);

/** A fake provider: answers with one vector per input (its seed is the text's position), in reverse order. */
function okResponse(inputs: string[], tokens = inputs.length * 10) {
  const data = inputs.map((_, index) => ({ index, embedding: vector(index) })).reverse();
  return new Response(JSON.stringify({ data, usage: { total_tokens: tokens } }), { status: 200 });
}

const options = { apiKey: "secret-key", model: "voyage-4-lite", inputType: "document" as const };

describe("embedTexts", () => {
  it("splits the texts into batches, keeps their order and adds up the tokens", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      okResponse(JSON.parse(String(init?.body)).input),
    );
    const result = await embedTexts(["a", "b", "c", "d", "e"], {
      ...options,
      batchSize: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.requests).toBe(3);
    expect(result.totalTokens).toBe(50);
    // Within each batch the fake answered in reverse; the result must still be in input order.
    expect(result.vectors.map((v) => v[0])).toEqual([0, 1, 0, 1, 0]);
  });

  it("sends the model, the input type, the vector size and the key", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      okResponse(JSON.parse(String(init?.body)).input),
    );
    await embedTexts(["a"], { ...options, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.voyageai.com/v1/embeddings");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "voyage-4-lite",
      input_type: "document",
      output_dimension: EMBEDDING_DIMENSIONS,
      truncation: false,
    });
  });

  it("retries after a rate limit (429) with a growing wait, then succeeds", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(okResponse(["a"]));
    const result = await embedTexts(["a"], { ...options, fetchImpl, sleep });
    expect(result.vectors).toHaveLength(1);
    expect(result.requests).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
  });

  it("waits as long as the server's Retry-After header says", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(okResponse(["a"]));
    await embedTexts(["a"], { ...options, fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("retries a dropped connection", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse(["a"]));
    const result = await embedTexts(["a"], { ...options, fetchImpl, sleep: async () => {} });
    expect(result.vectors).toHaveLength(1);
  });

  it("does not retry a client error, and never puts the key in the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid key", { status: 401 }));
    const failure = embedTexts(["a"], { ...options, fetchImpl, sleep: async () => {} });
    await expect(failure).rejects.toThrow(/HTTP 401/);
    await expect(failure).rejects.not.toThrow(/secret-key/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the maximum number of retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(
      embedTexts(["a"], { ...options, fetchImpl, sleep: async () => {}, maxRetries: 2 }),
    ).rejects.toThrow(/HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects a vector of the wrong size, and a wrong number of vectors", async () => {
    const wrongSize = new Response(
      JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }], usage: { total_tokens: 1 } }),
      { status: 200 },
    );
    await expect(
      embedTexts(["a"], { ...options, fetchImpl: vi.fn().mockResolvedValue(wrongSize) }),
    ).rejects.toThrow(/dimensions/);

    const tooFew = new Response(JSON.stringify({ data: [], usage: { total_tokens: 0 } }), {
      status: 200,
    });
    await expect(
      embedTexts(["a"], { ...options, fetchImpl: vi.fn().mockResolvedValue(tooFew) }),
    ).rejects.toThrow(/expected 1/);
  });

  it("does nothing for an empty list", async () => {
    const fetchImpl = vi.fn();
    const result = await embedTexts([], { ...options, fetchImpl });
    expect(result).toEqual({ vectors: [], totalTokens: 0, requests: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("embeddingCostUsd", () => {
  it("multiplies tokens by the list price per million", () => {
    expect(embeddingCostUsd("voyage-4-lite", 1_000_000)).toBeCloseTo(0.02);
    expect(embeddingCostUsd("voyage-4", 500_000)).toBeCloseTo(0.03);
  });

  it("returns undefined for a model it has no price for", () => {
    expect(embeddingCostUsd("some-other-model", 1000)).toBeUndefined();
  });
});
