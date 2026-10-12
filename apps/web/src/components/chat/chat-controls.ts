import { COUNTER_FROM_SHARE, MAX_USER_MESSAGE_CHARS } from "@/lib/ai/input-limits";

/**
 * Whether the Regenerate button may show. It must also show when the last message is the author's
 * own: pressing Stop before the first part of the answer arrived leaves no assistant message, and
 * without the button the author would have to type the question again. It does not show when the
 * day's allowance is spent, because asking again cannot work until the next day.
 */
export function canRegenerate(args: {
  busy: boolean;
  lastRole: string | undefined;
  dailyBudgetSpent?: boolean;
}): boolean {
  if (args.busy || args.dailyBudgetSpent) return false;
  return args.lastRole === "assistant" || args.lastRole === "user";
}

/**
 * What the text box says about the length of the message. Nothing is cut: a pasted scene stays in
 * the box so the author can shorten it. From 80% of the limit a counter shows, and over the limit it
 * says so and the message cannot be sent.
 */
export function messageLengthStatus(
  length: number,
  max: number = MAX_USER_MESSAGE_CHARS,
): { over: boolean; text: string | null } {
  const count = `${length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")} characters`;
  if (length > max) return { over: true, text: `${count}. Shorten it to send.` };
  if (length >= max * COUNTER_FROM_SHARE) return { over: false, text: count };
  return { over: false, text: null };
}
