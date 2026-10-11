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
