import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { after } from "next/server";

/**
 * LangSmith traces are sent in the background. On Vercel a function can be frozen as soon as the
 * response ends, which would lose the last runs of a trace. This keeps the function alive until
 * they are sent, after the response, so the author does not wait for it. With tracing off there is
 * nothing pending and it returns at once. Call it inside a request. Server-side only.
 */
export function flushTracesAfterResponse(): void {
  after(() => awaitAllCallbacks());
}
