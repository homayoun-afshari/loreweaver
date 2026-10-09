import { HttpResponse, delay, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "./circuit-breaker";
import { createLegacyClient } from "./client";

const BASE = "http://legacy.test";
const URL_STATE = `${BASE}/v1/characters/:id/state`;

const rawState = {
  char_id: 1,
  char_name: "Aria Voss",
  world_id: "world_aethel",
  loc_code: 17,
  inv_str: "flint,broken sword,health potion",
  status: { mana_pts: "020", hp_pts: "085", cond_flag: "OK" },
  last_upd: "09-OCT-26 14:32",
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A client with no real waiting: sleeps are recorded, jitter is fixed at "half". */
function makeClient(
  overrides: Parameters<typeof createLegacyClient>[0] extends infer O ? Partial<O> : never = {},
) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createLegacyClient({
    baseUrl: BASE,
    apiKey: "test-key",
    baseDelayMs: 100,
    maxDelayMs: 1000,
    sleep,
    random: () => 0.5,
    ...overrides,
  });
  return { client, sleep };
}

/** Responds with the given statuses in order, then repeats the last one. Counts calls. */
function sequence(...responses: Array<() => Response>) {
  let calls = 0;
  server.use(
    http.get(URL_STATE, () => {
      const make = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return make();
    }),
  );
  return { calls: () => calls };
}

const okResponse = () => HttpResponse.json(rawState);
const status = (code: number, headers?: Record<string, string>) => () =>
  new HttpResponse(JSON.stringify({ error: { code: "x", message: "x" } }), {
    status: code,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("legacy client: happy path", () => {
  it("returns a clean CharacterState and sends the API key", async () => {
    let apiKey: string | null = null;
    server.use(
      http.get(URL_STATE, ({ request }) => {
        apiKey = request.headers.get("X-API-Key");
        return okResponse();
      }),
    );
    const { client } = makeClient();

    const result = await client.getCharacterState(1);

    expect(apiKey).toBe("test-key");
    expect(result.ok && result.value.location.name).toBe("Ice Citadel");
  });
});

describe("legacy client: retries", () => {
  it("retries a 503 and then succeeds", async () => {
    const seq = sequence(status(503), status(503), okResponse);
    const { client, sleep } = makeClient();

    const result = await client.getCharacterState(1);

    expect(result.ok).toBe(true);
    expect(seq.calls()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially, with jitter", async () => {
    sequence(status(503));
    const { client, sleep } = makeClient({ maxRetries: 3 });

    await client.getCharacterState(1);

    // random() = 0.5, base 100: waits are 0.5 * 100, 0.5 * 200, 0.5 * 400
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100, 200]);
  });

  it("caps each wait at maxDelayMs", async () => {
    sequence(status(503));
    const { client, sleep } = makeClient({ maxRetries: 5, baseDelayMs: 400, maxDelayMs: 500 });

    await client.getCharacterState(1);

    for (const [ms] of sleep.mock.calls) expect(ms).toBeLessThanOrEqual(500);
  });

  it("gives up after maxRetries and returns a typed 'unavailable' error", async () => {
    const seq = sequence(status(503));
    const { client } = makeClient({ maxRetries: 3 });

    const result = await client.getCharacterState(1);

    expect(seq.calls()).toBe(4); // first try + 3 retries
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        reason: "server_error",
        stale: true,
        message: "Character service unavailable; state may be stale.",
      },
    });
  });

  it("retries a 429 and honours a short Retry-After", async () => {
    sequence(status(429, { "Retry-After": "1" }), okResponse);
    const { client, sleep } = makeClient();

    const result = await client.getCharacterState(1);

    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not wait for a long Retry-After: it returns rate_limited at once", async () => {
    const seq = sequence(status(429, { "Retry-After": "40" }));
    const { client, sleep } = makeClient();

    const result = await client.getCharacterState(1);

    expect(seq.calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(!result.ok && result.error.kind === "unavailable" && result.error.reason).toBe(
      "rate_limited",
    );
  });

  it("retries network errors", async () => {
    let calls = 0;
    server.use(
      http.get(URL_STATE, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : okResponse();
      }),
    );
    const { client } = makeClient();

    expect((await client.getCharacterState(1)).ok).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("legacy client: errors that must NOT be retried", () => {
  it("returns not_found for 404 after a single call", async () => {
    const seq = sequence(status(404));
    const { client, sleep } = makeClient();

    const result = await client.getCharacterState(99);

    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(seq.calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns unauthorized for 401 after a single call", async () => {
    const seq = sequence(status(401));
    const { client } = makeClient();

    const result = await client.getCharacterState(1);

    expect(!result.ok && result.error.kind).toBe("unauthorized");
    expect(seq.calls()).toBe(1);
  });

  it("returns invalid_response when the body breaks the contract", async () => {
    sequence(() => HttpResponse.json({ ...rawState, loc_code: "17" }));
    const { client } = makeClient();

    const result = await client.getCharacterState(1);

    expect(!result.ok && result.error.kind).toBe("invalid_response");
  });

  it("returns invalid_response for a body that is not JSON", async () => {
    sequence(() => new HttpResponse("<html>oops</html>", { status: 200 }));
    const { client } = makeClient();

    const result = await client.getCharacterState(1);

    expect(!result.ok && result.error.kind).toBe("invalid_response");
  });

  it("rejects a bad id without calling the network", async () => {
    const seq = sequence(okResponse);
    const { client } = makeClient();

    const result = await client.getCharacterState(-3);

    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(seq.calls()).toBe(0);
  });
});

describe("legacy client: timeout", () => {
  it("times out a slow response and reports reason 'timeout'", async () => {
    server.use(
      http.get(URL_STATE, async () => {
        await delay(300);
        return okResponse();
      }),
    );
    const { client } = makeClient({ timeoutMs: 50, maxRetries: 0 });

    const result = await client.getCharacterState(1);

    expect(!result.ok && result.error.kind === "unavailable" && result.error.reason).toBe(
      "timeout",
    );
  });
});

describe("legacy client: circuit breaker", () => {
  it("opens after repeated failures and then fails fast without calling the CMS", async () => {
    const seq = sequence(status(503));
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const { client } = makeClient({ breaker, maxRetries: 0 });

    await client.getCharacterState(1);
    await client.getCharacterState(1);
    expect(seq.calls()).toBe(2);

    const result = await client.getCharacterState(1);

    expect(seq.calls()).toBe(2); // no new request
    expect(!result.ok && result.error.kind === "unavailable" && result.error.reason).toBe(
      "circuit_open",
    );
  });

  it("does not count 404 as a failure (the service is alive)", async () => {
    sequence(status(404));
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    const { client } = makeClient({ breaker });

    await client.getCharacterState(1);
    await client.getCharacterState(1);
    await client.getCharacterState(1);

    expect(breaker.state).toBe("closed");
  });
});
