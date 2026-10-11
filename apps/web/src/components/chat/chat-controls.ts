/**
 * Whether the Regenerate button may show. It must also show when the last message is the author's
 * own: pressing Stop before the first part of the answer arrived leaves no assistant message, and
 * without the button the author would have to type the question again.
 */
export function canRegenerate(args: { busy: boolean; lastRole: string | undefined }): boolean {
  return !args.busy && (args.lastRole === "assistant" || args.lastRole === "user");
}
