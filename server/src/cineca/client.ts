import { Agent, request } from 'undici';
import { isCinecaHost } from '@planner/shared';
import { resolvePublic, SsrfError } from './ssrf.ts';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

class PinnedAgent extends Agent {
  constructor(pin: Map<string, string>) {
    super({
      connect: {
        // Node's net/tls connect (with autoSelectFamily, on by default) calls
        // this with { all: true } for Happy Eyeballs and expects an array
        // back; passing only the single-address 3-arg form here silently
        // produces address=undefined downstream (ERR_INVALID_IP_ADDRESS).
        lookup: (hostname, options, callback) => {
          const address = pin.get(hostname);
          const cb = typeof options === 'function' ? options : callback;
          const wantsAll = typeof options === 'object' && options !== null && 'all' in options && options.all;
          if (!address) {
            cb(new SsrfError(`Unpinned host ${hostname}`), wantsAll ? [] : '', 0);
            return;
          }
          const family = address.includes(':') ? 6 : 4;
          if (wantsAll) {
            cb(null, [{ address, family }]);
          } else {
            cb(null, address, family);
          }
        },
      },
    });
  }
}

export class CinecaFetchError extends Error {}

/**
 * Fetches a Cineca API endpoint on an allowlisted host only. DNS is
 * resolved once, checked against private/loopback ranges, then pinned so
 * TOCTOU rebinding cannot redirect the request after the check.
 */
export async function fetchCinecaJson(
  host: string,
  urlPath: string,
  init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  if (!isCinecaHost(host)) throw new CinecaFetchError(`Host not allowlisted: ${host}`);

  const resolved = await resolvePublic(host);
  const pin = new Map(resolved.map((r) => [host, r.address] as const));
  const agent = new PinnedAgent(pin);

  const url = new URL(`https://${host}${urlPath}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
  }

  try {
    const res = await request(url, {
      method: init.method,
      dispatcher: agent,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
      // No redirect interceptor is attached, so undici never follows
      // redirects here; a 3xx is treated like any other bad status below.
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.body.destroy();
      throw new CinecaFetchError(`Unexpected status ${res.statusCode} from ${host}${urlPath}`);
    }
    const contentType = res.headers['content-type'];
    if (!contentType || !String(contentType).includes('application/json')) {
      res.body.destroy();
      throw new CinecaFetchError(`Unexpected content-type from ${host}${urlPath}`);
    }

    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        res.body.destroy();
        throw new CinecaFetchError('Response too large');
      }
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await agent.close();
  }
}
