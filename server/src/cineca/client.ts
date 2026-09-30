import type { LookupFunction, Socket } from 'node:net';
import { Agent, buildConnector, request } from 'undici';
import { isCinecaHost } from '@planner/shared';
import { createLimiter } from '../limiter.ts';
import { resolvePublic, SsrfError, type ResolvedHost } from './ssrf.ts';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 3_000;

// Every address resolvePublic verified as public, per host. Pinning all of them
// (not just one) lets Node's connect race them, so a dead address in Cineca's DNS
// round-robin costs a fraction of a second instead of a full connect timeout.
export function pinnedLookup(pin: Map<string, ResolvedHost[]>): LookupFunction {
  return (hostname, options, callback) => {
    const addresses = pin.get(hostname);
    const cb = typeof options === 'function' ? options : callback;
    // Node's net/tls connect (with autoSelectFamily) calls this with { all: true }
    // for Happy Eyeballs and expects an array back; the single-address 3-arg form
    // is only for callers that did not ask for all.
    const wantsAll = typeof options === 'object' && options !== null && 'all' in options && options.all;
    if (!addresses?.length) {
      cb(new SsrfError(`Unpinned host ${hostname}`), wantsAll ? [] : '', 0);
      return;
    }
    if (wantsAll) {
      cb(null, addresses.map(({ address, family }) => ({ address, family })));
    } else {
      cb(null, addresses[0]!.address, addresses[0]!.family);
    }
  };
}

// Address that last connected, per host. Tried first next time, so a dead
// address early in the DNS list costs nothing; it self-heals if this one dies.
const lastGoodAddress = new Map<string, string>();

export function preferLastGood(host: string, resolved: ResolvedHost[]): ResolvedHost[] {
  const first = resolved.find((r) => r.address === lastGoodAddress.get(host));
  return first ? [first, ...resolved.filter((r) => r !== first)] : resolved;
}

export function createPinnedAgent(host: string, resolved: ResolvedHost[]): Agent {
  const connector = buildConnector({
    lookup: pinnedLookup(new Map([[host, preferLastGood(host, resolved)]])),
    autoSelectFamily: true,
  });
  return new Agent({
    connect: (opts, callback) =>
      connector(opts, (...args) => {
        const [err, socket] = args;
        const address = err ? undefined : (socket as Socket).remoteAddress;
        if (address) lastGoodAddress.set(host, address);
        callback(...args);
      }),
  });
}

export class CinecaFetchError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global cap on in-flight upstream requests, whatever the number of users or
// sources loading: Cineca starts failing when hit with too many at once
const MAX_CONCURRENT_UPSTREAM = 6;
const withUpstreamSlot = createLimiter(MAX_CONCURRENT_UPSTREAM);

// A blocked address or an oversized body will fail the same way every time;
// only a slow/flaky upstream response is worth retrying.
function isRetryable(err: unknown): boolean {
  if (err instanceof SsrfError) return false;
  if (err instanceof CinecaFetchError) return !err.message.startsWith('Response too large');
  return true;
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return exp * (0.5 + Math.random() * 0.5);
}

/**
 * Fetches a Cineca API endpoint on an allowlisted host only. DNS is
 * resolved once, checked against private/loopback ranges, then pinned so
 * TOCTOU rebinding cannot redirect the request after the check. Retries a
 * failed attempt with exponential backoff, since Cineca occasionally times
 * out or errors under load.
 */
export async function fetchCinecaJson(
  host: string,
  urlPath: string,
  init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  if (!isCinecaHost(host)) throw new CinecaFetchError(`Host not allowlisted: ${host}`);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await withUpstreamSlot(() => fetchCinecaJsonAttempt(host, urlPath, init));
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryable(err)) throw err;
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastErr;
}

async function fetchCinecaJsonAttempt(
  host: string,
  urlPath: string,
  init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const resolved = await resolvePublic(host);
  const agent = createPinnedAgent(host, resolved);

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

    // A destroyed body emits 'error'; unhandled, that crashes the process
    res.body.on('error', () => {});

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
