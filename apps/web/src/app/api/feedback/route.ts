import { getDb } from "@/db";
import { feedbackEvents } from "@/db/schema";
import { parseFeedbackRequest, toFeedbackRow } from "@/lib/feedback/feedback-request";

/** Stores one feedback event (thumbs up, thumbs down or copy) for an assistant message. */
export async function POST(request: Request): Promise<Response> {
  const body = parseFeedbackRequest(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await getDb().insert(feedbackEvents).values(toFeedbackRow(body));
  } catch (error) {
    // The details (host, credentials in a connection error) stay in the server log.
    console.error("[feedback] insert failed", error);
    return Response.json({ error: "Could not save feedback." }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
