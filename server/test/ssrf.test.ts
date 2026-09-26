import { describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));

const { resolvePublic, SsrfError } = await import('../src/cineca/ssrf.ts');

function mockAddresses(addresses: { address: string; family: number }[]) {
  lookupMock.mockResolvedValueOnce(addresses);
}

describe('resolvePublic', () => {
  it('accepts a public IPv4 address', async () => {
    mockAddresses([{ address: '93.184.216.34', family: 4 }]);
    const result = await resolvePublic('example.com');
    expect(result).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['private class A', '10.1.2.3'],
    ['private class B', '172.16.0.5'],
    ['private class C', '192.168.1.10'],
    ['link-local', '169.254.1.1'],
    ['cgnat', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['unspecified', '0.0.0.0'],
    ['broadcast', '255.255.255.255'],
  ])('rejects %s address %s', async (_label, address) => {
    mockAddresses([{ address, family: 4 }]);
    await expect(resolvePublic('evil.example')).rejects.toBeInstanceOf(SsrfError);
  });

  it.each([
    ['ipv6 loopback', '::1'],
    ['ipv6 unique local', 'fd00::1'],
    ['ipv6 link-local', 'fe80::1'],
    ['ipv4-mapped loopback', '::ffff:127.0.0.1'],
  ])('rejects %s', async (_label, address) => {
    mockAddresses([{ address, family: 6 }]);
    await expect(resolvePublic('evil.example')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects when any resolved address is private (multi-A rebinding)', async () => {
    mockAddresses([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolvePublic('evil.example')).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects when DNS returns no records', async () => {
    mockAddresses([]);
    await expect(resolvePublic('evil.example')).rejects.toBeInstanceOf(SsrfError);
  });
});
