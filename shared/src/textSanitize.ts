// Zero-width joiners/spaces and bidi-override marks, by code point rather
// than as literal characters so no invisible glyph sits in this file.
const BIDI_AND_INVISIBLE = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

/**
 * Rejects control characters, backslashes and invisible/bidi-override code
 * points in stored, rendered-back free text (e.g. folder names). Unlike
 * sourceUrl's parser this does not reject whitespace in general, since
 * ordinary multi-word labels must stay valid.
 */
export function hasControlOrInvisibleChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex -- rejecting C0/C1 controls is the point
  if (/[\x00-\x1f\x7f-\x9f\\]/.test(s)) return true;
  for (const ch of s) {
    if (BIDI_AND_INVISIBLE.has(ch.codePointAt(0)!)) return true;
  }
  return false;
}
