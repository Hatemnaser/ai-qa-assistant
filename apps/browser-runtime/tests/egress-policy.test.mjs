import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedHosts, isPublicAddress, resolveConnect } from '../src/egress-policy.mjs';

describe('browser egress authority', () => {
  it('rejects internal, metadata, reserved and unsupported IPv6 destinations', () => {
    for (const address of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','198.18.0.1','198.51.100.5','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','fc00::1','2001:db8::1','2001:2::1','2002::1','3fff::1']) assert.equal(isPublicAddress(address), false, address);
    assert.equal(isPublicAddress('93.184.216.34'), true);
    assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  });
  it('permits exact HTTPS origins only, without wildcards, credentials or ports', () => {
    for (const origin of ['http://example.com','https://example.com/app','https://example.com:8443','https://user@example.com','https://*.example.com','https://127.0.0.1','https://example.com?x=1']) assert.throws(() => allowedHosts([origin]));
    assert.deepEqual([...allowedHosts(['https://example.com'])], ['example.com']);
  });
  it('resolves once and pins the public literal used for CONNECT', async () => {
    let reads = 0;
    const result = await resolveConnect('example.com:443', allowedHosts(['https://example.com']), async () => { reads++; return [{ address: '93.184.216.34' }]; });
    assert.equal(reads, 1); assert.deepEqual(result, { address: '93.184.216.34', port: 443 });
  });
  it('rejects rebinding, mixed answers, alternate ports and unapproved subdomains', async () => {
    const hosts = allowedHosts(['https://example.com']);
    for (const addresses of [[],[{ address: '127.0.0.1' }],[{ address: '93.184.216.34' },{ address: '10.1.1.1' }]]) await assert.rejects(resolveConnect('example.com:443', hosts, async () => addresses));
    for (const authority of ['other.example.com:443','example.com:80','example.com:0443','example.com.:443','127.0.0.1:443','example.com@127.0.0.1:443']) await assert.rejects(resolveConnect(authority, hosts, async () => [{ address: '93.184.216.34' }]));
    let reads = 0;
    const lookup = async () => [{ address: ++reads === 1 ? '93.184.216.34' : '169.254.169.254' }];
    await resolveConnect('example.com:443', hosts, lookup);
    await assert.rejects(resolveConnect('example.com:443', hosts, lookup));
    await assert.rejects(resolveConnect('example.com:443', hosts, async () => [{ address: '2001:4860:4860::8888' }]));
  });
});
