/**
 * The size limits of what an author sends. In a file of their own, with no imports, so the browser
 * (the text box) and the server (the request check) read the same numbers.
 */

/**
 * The longest message an author can send, in characters: about 1,400 words, enough for a pasted
 * scene. The model reads it on every call of the run, so a longer one multiplies its cost.
 */
export const MAX_USER_MESSAGE_CHARS = 8_000;
