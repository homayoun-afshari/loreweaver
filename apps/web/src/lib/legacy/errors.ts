/**
 * What can go wrong when talking to the legacy CMS, as data instead of exceptions.
 * Callers (later: the agent's tools) switch on `kind` and get a message they can show or reason about.
 */
export type LegacyError =
  | { kind: "not_found"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "invalid_response"; message: string }
  | {
      kind: "unavailable";
      /** Why: the call timed out, the server failed or limited us, the network broke, or the breaker is open. */
      reason: "timeout" | "server_error" | "rate_limited" | "network" | "circuit_open";
      /** Always true: if the CMS can't answer, any state we showed earlier may be stale. */
      stale: true;
      message: string;
    };

/** Either a value or an error. Forces callers to handle both cases. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const unavailable = (
  reason: Extract<LegacyError, { kind: "unavailable" }>["reason"],
): LegacyError => ({
  kind: "unavailable",
  reason,
  stale: true,
  message: "Character service unavailable; state may be stale.",
});
