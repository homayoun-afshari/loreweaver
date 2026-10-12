/**
 * The size limits of what an author sends. In a file of their own, with no imports, so the browser
 * (the text box) and the server (the request check) read the same numbers and the same words.
 */

/**
 * The longest message an author can send, in characters: about 1,400 words, enough for a pasted
 * scene. The model reads it on every call of the run, so a longer one multiplies its cost.
 */
export const MAX_USER_MESSAGE_CHARS = 8_000;

/** What the author is told when a message is over the limit, by the text box and by the server. */
export const MESSAGE_TOO_LONG = `Your message is too long: the limit is ${MAX_USER_MESSAGE_CHARS.toLocaleString("en-US")} characters. Shorten it and send it again.`;

/** From this share of the limit on, the text box shows how many characters are used. */
export const COUNTER_FROM_SHARE = 0.8;
