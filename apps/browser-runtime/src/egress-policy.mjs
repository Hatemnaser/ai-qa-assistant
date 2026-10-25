import { isIP } from 'node:net';

// Transport uses IPv4 initially. Validate public IPv6 DNS answers too, so
// ordinary dual-stack hosts work without admitting mapped/private addresses.
export function isPublicAddress(address) {
  if (isIP(address) === 6) {
    const [a, b] = address.split(':').map(word => parseInt(word || '0', 16));
    return a >= 0x2000 && a < 0x3ffe && a !== 0x2002
      && !(a === 0x2001 && (b < 0x0200 || b === 0x0db8));
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}

export function allowedHosts(origins) {
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 65) throw new Error('Invalid egress policy.');
  return new Set(origins.map(origin => {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.port || url.username || url.password
      || isIP(url.hostname) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(url.hostname)) throw new Error('Invalid egress origin.');
    return url.hostname;
  }));
}

export async function resolveConnect(authority, hosts, lookup) {
  if (!/^[a-z0-9.-]+:443$/u.test(authority)) throw new Error('Destination blocked.');
  const hostname = authority.slice(0, -4);
  if (!hosts.has(hostname)) throw new Error('Destination blocked.');
  const addresses = await lookup(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Destination blocked.');
  // Connect to this literal address, never perform a second DNS lookup in TCP.
  const selected = addresses.find(({ address }) => isIP(address) === 4);
  if (!selected) throw new Error('IPv4 transport required.');
  return { address: selected.address, port: 443 };
}
