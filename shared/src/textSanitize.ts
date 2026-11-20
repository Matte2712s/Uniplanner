// Zero-width, bidi-control and other invisible or line-breaking code points,
// by number rather than as literal characters so no invisible glyph sits in this file.
const BIDI_AND_INVISIBLE = new Set([
  // soft hyphen, Arabic letter mark, Mongolian vowel separator
  0x00ad, 0x061c, 0x180e,
  // zero-width space/joiners, LRM/RLM
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  // line/paragraph separators, bidi embeddings and overrides
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  // word joiner and invisible operators
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
  // bidi isolates
  0x2066, 0x2067, 0x2068, 0x2069,
  // zero-width no-break space (BOM)
  0xfeff,
]);

export interface TextCheckOptions {
  // Multi-line free text (e.g. event notes): permit LF only, every other control stays rejected
  allowNewline?: boolean;
}

/**
 * Rejects control characters, backslashes and invisible/bidi-override code
 * points in stored, rendered-back free text (e.g. folder names). Unlike
 * sourceUrl's parser this does not reject whitespace in general, since
 * ordinary multi-word labels must stay valid.
 */
export function hasControlOrInvisibleChars(s: string, options: TextCheckOptions = {}): boolean {
  const text = options.allowNewline ? s.replaceAll('\n', '') : s;
  // eslint-disable-next-line no-control-regex -- rejecting C0/C1 controls is the point
  if (/[\x00-\x1f\x7f-\x9f\\]/.test(text)) return true;
  for (const ch of text) {
    if (BIDI_AND_INVISIBLE.has(ch.codePointAt(0)!)) return true;
  }
  return false;
}
