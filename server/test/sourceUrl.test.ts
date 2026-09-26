import { describe, expect, it } from 'vitest';
import { parseSourceUrl } from '@planner/shared';

const VALID = 'https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839';

describe('parseSourceUrl', () => {
  it('accepts a well-formed Cineca calendar URL', () => {
    const result = parseSourceUrl(VALID);
    expect(result).toEqual({
      ok: true,
      value: { host: 'unito.prod.up.cineca.it', linkCalendarioId: '612617b82db4bb0017172839' },
    });
  });

  it('accepts extra query-like params after the id', () => {
    const result = parseSourceUrl(`${VALID}&lang=en`);
    expect(result.ok).toBe(true);
  });

  it.each<[string, string]>([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['http scheme', 'http://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['lookalike suffix host', 'https://cineca.it.evil.com/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['host in path', 'https://evil.com/unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['host in query', 'https://evil.com/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839?x=unito.prod.up.cineca.it'],
    ['credentials in url', 'https://user:pass@unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['non-default port', 'https://unito.prod.up.cineca.it:8443/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['bare ipv4 host', 'https://1.2.3.4/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['punycode host', 'https://xn--nito-9na.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
    ['wrong path', 'https://unito.prod.up.cineca.it/somethingElse/linkCalendarioId=612617b82db4bb0017172839'],
    ['missing link id', 'https://unito.prod.up.cineca.it/calendarioPubblico/'],
    ['short link id', 'https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=abc'],
    ['non-hex link id', `https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=${'g'.repeat(24)}`],
    [
      'double-encoded id',
      `https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=${encodeURIComponent('612617b82db4bb0017172839')}%252e`,
    ],
    ['control chars', 'https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839\u0000'],
    ['overlong input', `https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=${'a'.repeat(3000)}`],
    ['not a url', 'not a url at all'],
    ['other cineca product', 'https://unito.esse3.cineca.it/calendarioPubblico/linkCalendarioId=612617b82db4bb0017172839'],
  ])('rejects: %s', (_label, input) => {
    const result = parseSourceUrl(input);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(parseSourceUrl(null).ok).toBe(false);
    expect(parseSourceUrl(undefined).ok).toBe(false);
    expect(parseSourceUrl(123).ok).toBe(false);
    expect(parseSourceUrl({}).ok).toBe(false);
  });
});
