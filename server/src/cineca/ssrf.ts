import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class SsrfError extends Error {}

// Blocks loopback, private, link-local, multicast, CGNAT, ULA and other
// non-public ranges so a resolved Cineca hostname can never reach internal
// infrastructure.
function isPublicAddress(ip: string): boolean {
  const addr = ipaddr.process(ip);
  const range = addr.range();
  if (addr.kind() === 'ipv4') {
    return range === 'unicast';
  }
  // ipaddr.js ipv6 ranges: 'unicast' covers global unicast only when not
  // mapped/special; explicitly allow only that.
  return range === 'unicast';
}

export interface ResolvedHost {
  address: string;
  family: 4 | 6;
}

/** Resolves a hostname and rejects it if any address is non-public. */
export async function resolvePublic(hostname: string): Promise<ResolvedHost[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new SsrfError('No DNS records');
  const resolved: ResolvedHost[] = [];
  for (const r of records) {
    if (!isPublicAddress(r.address)) {
      throw new SsrfError(`Refusing non-public address ${r.address} for ${hostname}`);
    }
    resolved.push({ address: r.address, family: r.family as 4 | 6 });
  }
  return resolved;
}
