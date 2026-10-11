/**
 * Server-side timing of one chat request, measured from the moment the route starts.
 *  - serverTtftMs: until the first text token of the answer was produced.
 *  - serverFirstUiMs: until the first tool call reached the browser. That is the moment it can
 *    show a card skeleton, so it is the server's "time to first UI". With the agent graph a tool
 *    call is sent when the model has finished writing it, not while it is being written.
 *  - serverTotalMs: until the model finished.
 * The numbers travel to the browser as message metadata, next to the token counts.
 */
export function createChatTimer(now: () => number = () => performance.now()) {
  const startedAt = now();
  let firstTextMs: number | undefined;
  let firstUiMs: number | undefined;

  const round = (ms: number | undefined) => (ms === undefined ? undefined : Math.round(ms));

  return {
    /** Call with the type of every streamed chunk (`text-delta`, `tool-input-available`, ...). */
    markChunk(type: string): void {
      const elapsed = now() - startedAt;
      if (type === "text-delta") firstTextMs ??= elapsed;
      if (type === "tool-input-start" || type === "tool-input-available") firstUiMs ??= elapsed;
    },
    snapshot() {
      return {
        serverTtftMs: round(firstTextMs),
        serverFirstUiMs: round(firstUiMs),
        serverTotalMs: round(now() - startedAt),
      };
    },
  };
}
