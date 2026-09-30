import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, request } from 'undici';
import { describe, expect, it } from 'vitest';
import { createPinnedAgent, pinnedLookup, preferLastGood } from '../src/cineca/client.ts';
import { SsrfError, type ResolvedHost } from '../src/cineca/ssrf.ts';

const HOST = 'cineca.test';
const PINNED: ResolvedHost[] = [
  { address: '15.161.12.36', family: 4 },
  { address: '16.22.161.63', family: 4 },
];

function lookup(pin: Map<string, ResolvedHost[]>, host: string, options: { all?: boolean }) {
  return new Promise<{ err: Error | null; address: unknown; family: unknown }>((resolve) => {
    pinnedLookup(pin)(host, options as never, ((err: Error | null, address: unknown, family: unknown) =>
      resolve({ err, address, family })) as never);
  });
}

describe('pinnedLookup', () => {
  it('answers with every pinned address when asked for all', async () => {
    const { err, address } = await lookup(new Map([[HOST, PINNED]]), HOST, { all: true });
    expect(err).toBeNull();
    expect(address).toEqual(PINNED);
  });

  it('answers with the first pinned address for a single-address lookup', async () => {
    const { err, address, family } = await lookup(new Map([[HOST, PINNED]]), HOST, {});
    expect(err).toBeNull();
    expect(address).toBe('15.161.12.36');
    expect(family).toBe(4);
  });

  it('refuses a host that was not pinned', async () => {
    const { err } = await lookup(new Map([[HOST, PINNED]]), 'evil.example.com', { all: true });
    expect(err).toBeInstanceOf(SsrfError);
  });

  it('connects through a later address when the first one is unreachable', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    // 192.0.2.1 is reserved for documentation and never answers
    const pin = new Map<string, ResolvedHost[]>([
      [HOST, [{ address: '192.0.2.1', family: 4 }, { address: '127.0.0.1', family: 4 }]],
    ]);
    const agent = new Agent({ connect: { lookup: pinnedLookup(pin), autoSelectFamily: true } });
    try {
      const res = await request(`http://${HOST}:${port}/`, { dispatcher: agent });
      expect(res.statusCode).toBe(200);
      expect(await res.body.text()).toBe('ok');
    } finally {
      await agent.close();
      server.close();
    }
  }, 8000);

  it('remembers the address that connected and tries it first next time', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const host = 'remember.test';
    const dead: ResolvedHost = { address: '192.0.2.1', family: 4 };
    const live: ResolvedHost = { address: '127.0.0.1', family: 4 };
    expect(preferLastGood(host, [dead, live])).toEqual([dead, live]);

    const agent = createPinnedAgent(host, [dead, live]);
    try {
      const res = await request(`http://${host}:${port}/`, { dispatcher: agent });
      expect(res.statusCode).toBe(200);
      await res.body.text();
    } finally {
      await agent.close();
      server.close();
    }

    expect(preferLastGood(host, [dead, live])).toEqual([live, dead]);
  }, 8000);
});
