// Only University Planner instances share the reverse-engineered API
export const CINECA_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.prod\.up\.cineca\.it$/;
export const LINK_ID_RE = /^[a-f0-9]{24}$/;
export const MAX_SOURCE_URL_LENGTH = 2048;

// Zero-width joiners/spaces and bidi-override marks, by code point rather
// than as literal characters so no invisible glyph sits in this file.
const BIDI_AND_INVISIBLE = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

export type SourceUrlError =
  | 'empty'
  | 'too_long'
  | 'invalid_chars'
  | 'invalid_url'
  | 'not_https'
  | 'credentials'
  | 'port'
  | 'host'
  | 'path'
  | 'link_id';

export interface ParsedSourceUrl {
  host: string;
  linkCalendarioId: string;
}

export type ParseResult =
  | { ok: true; value: ParsedSourceUrl }
  | { ok: false; error: SourceUrlError };

const fail = (error: SourceUrlError): ParseResult => ({ ok: false, error });

export function isCinecaHost(host: string): boolean {
  if (!CINECA_HOST_RE.test(host)) return false;
  // Punycode labels allow look-alike hosts
  return !host.split('.').some((label) => label.startsWith('xn--'));
}

export function parseSourceUrl(input: unknown): ParseResult {
  if (typeof input !== 'string') return fail('invalid_url');
  const raw = input.trim();
  if (!raw) return fail('empty');
  if (raw.length > MAX_SOURCE_URL_LENGTH) return fail('too_long');
  // Whitespace, control and backslash are never part of a legit link.
  // eslint-disable-next-line no-control-regex -- rejecting C0/C1 controls is the point
  if (/[\s\x00-\x1f\x7f-\x9f\\]/.test(raw)) {
    return fail('invalid_chars');
  }
  // Zero-width and bidi-override code points: kept as numeric code points
  // (not literal characters) so none of them sit invisibly in this file.
  for (const ch of raw) {
    if (BIDI_AND_INVISIBLE.has(ch.codePointAt(0)!)) return fail('invalid_chars');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('invalid_url');
  }

  if (url.protocol !== 'https:') return fail('not_https');
  if (url.username || url.password) return fail('credentials');
  if (url.port !== '') return fail('port');

  const host = url.hostname.toLowerCase();
  if (!isCinecaHost(host)) return fail('host');

  const prefix = '/calendarioPubblico/';
  if (!url.pathname.startsWith(prefix)) return fail('path');

  // Params live in the path, e.g. /calendarioPubblico/linkCalendarioId=<id>&lang=en
  let tail: string;
  try {
    tail = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return fail('link_id');
  }
  const params = new Map<string, string>();
  for (const pair of tail.split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0) params.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const id = (params.get('linkCalendarioId') ?? url.searchParams.get('linkCalendarioId') ?? '').toLowerCase();
  if (!LINK_ID_RE.test(id)) return fail('link_id');

  return { ok: true, value: { host, linkCalendarioId: id } };
}

export function canonicalCalendarUrl(host: string, linkCalendarioId: string): string {
  return `https://${host}/calendarioPubblico/linkCalendarioId=${linkCalendarioId}`;
}
