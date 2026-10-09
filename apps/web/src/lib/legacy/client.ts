import { CircuitBreaker } from "./circuit-breaker";
import { characterStateSchema, type CharacterState } from "./character-state";
import { err, ok, unavailable, type LegacyError, type Result } from "./errors";

export interface LegacyClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt (so 3 means up to 4 calls). */
  maxRetries?: number;
  /** First backoff step; doubles each retry. */
  baseDelayMs?: number;
  /** Upper bound for any single wait. */
  maxDelayMs?: number;
  breaker?: CircuitBreaker;
  // Injectable so tests are fast and deterministic.
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Outcome of one HTTP attempt. */
type Attempt =
  | { type: "done"; result: Result<CharacterState, LegacyError> }
  | { type: "retry"; error: LegacyError; retryAfterMs?: number };

export function createLegacyClient(options: LegacyClientOptions) {
  const {
    baseUrl,
    apiKey,
    timeoutMs = 2000,
    maxRetries = 3,
    baseDelayMs = 200,
    maxDelayMs = 2000,
    breaker = new CircuitBreaker(),
    fetch: fetchImpl = fetch,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
  } = options;

  async function attemptOnce(url: string): Promise<Attempt> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { "X-API-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      return { type: "retry", error: unavailable(timedOut ? "timeout" : "network") };
    }

    if (response.status === 404) {
      return {
        type: "done",
        result: err({ kind: "not_found", message: "Character not found." }),
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        type: "done",
        result: err({ kind: "unauthorized", message: "Legacy CMS rejected the API key." }),
      };
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      return {
        type: "retry",
        error: unavailable("rate_limited"),
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
      };
    }
    if (response.status >= 500) {
      return { type: "retry", error: unavailable("server_error") };
    }
    if (!response.ok) {
      return {
        type: "done",
        result: err({ kind: "invalid_response", message: `Unexpected status ${response.status}.` }),
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        type: "done",
        result: err({ kind: "invalid_response", message: "Legacy CMS returned invalid JSON." }),
      };
    }
    const parsed = characterStateSchema.safeParse(body);
    if (!parsed.success) {
      return {
        type: "done",
        result: err({
          kind: "invalid_response",
          message: `Legacy CMS response did not match the contract: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
        }),
      };
    }
    return { type: "done", result: ok(parsed.data) };
  }

  /** Exponential backoff with full jitter: wait a random time between 0 and base * 2^retry. */
  function backoffMs(retry: number): number {
    return random() * Math.min(maxDelayMs, baseDelayMs * 2 ** retry);
  }

  async function getCharacterState(id: number): Promise<Result<CharacterState, LegacyError>> {
    if (!Number.isInteger(id) || id <= 0) {
      return err({ kind: "not_found", message: "Character id must be a positive integer." });
    }
    if (!breaker.canRequest()) {
      return err(unavailable("circuit_open"));
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/v1/characters/${id}/state`;
    let lastError: LegacyError = unavailable("network");

    for (let retry = 0; retry <= maxRetries; retry++) {
      const attempt = await attemptOnce(url);

      if (attempt.type === "done") {
        // The CMS answered (even with "not found"), so it is alive.
        breaker.recordSuccess();
        return attempt.result;
      }

      lastError = attempt.error;
      if (retry === maxRetries) break;

      // The server asked us to wait longer than we are willing to: give up now.
      if (attempt.retryAfterMs !== undefined && attempt.retryAfterMs > maxDelayMs) break;

      await sleep(Math.max(backoffMs(retry), attempt.retryAfterMs ?? 0));
    }

    breaker.recordFailure();
    return err(lastError);
  }

  return { getCharacterState };
}

export type LegacyClient = ReturnType<typeof createLegacyClient>;
