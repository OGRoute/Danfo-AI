/**
 * Turn a chat reply into text that reads well aloud: no markdown symbols or
 * emoji, and prices spoken as "500 to 800 naira" instead of "₦500–₦800".
 * Shared by the browser voice and the server TTS engines.
 */
export function toSpeakable(text: string): string {
  return text
    .replace(/[*#_`>|]+/g, " ")
    .replace(/₦\s?([\d,]+)\s*(?:–|-|to)\s*₦?\s?([\d,]+)/g, "$1 to $2 naira")
    .replace(/₦\s?([\d,]+)/g, "$1 naira")
    .replace(/[→↔]/g, " to ")
    .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27bf]|\ufe0f/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
