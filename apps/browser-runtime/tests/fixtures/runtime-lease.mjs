import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';

// Exercise the production module with inert OS adapters and a controlled clock.
// No browser process, server or outbound request is created by this fixture.
const scenario = process.argv[2], signals = {}, intervals = [], token = 'e'.repeat(64);
let now = 10_000, handler, kills = 0, upgrade;
const context = vm.createContext({
  Buffer, Date: class extends Date { static now() { return now; } },
  process: { env: { ODDPATH_RUNTIME_TOKEN: token, ODDPATH_DEADLINE_MS: '110000', ODDPATH_LEASE_MS: '11000' },
    getuid: () => 10001, on(name, fn) { signals[name] = fn; }, kill() { kills++; }, exit() {} },
  setTimeout: () => ({ unref() {} }), setInterval: fn => { intervals.push(fn); return 1; },
});
const adapters = {
  'node:child_process': { spawn() { return Object.assign(new EventEmitter(), { pid: 999 }); } },
  'node:http': { createServer(fn) { handler = fn; return { on(name, fn) { if (name === 'upgrade') upgrade = fn; }, listen() {} }; },
    request() { throw Error('Unexpected outbound request'); } },
  'node:crypto': { timingSafeEqual },
  'node:fs/promises': { async mkdir() {}, async stat() { return { isSocket: () => true }; } },
};
const source = await readFile(new URL('../../src/runtime-main.mjs', import.meta.url), 'utf8');
const runtime = new vm.SourceTextModule(source, { context });
await runtime.link(async name => {
  if(name==='./login-boundary.mjs')return new vm.SourceTextModule(await readFile(new URL('../../src/login-boundary.mjs',import.meta.url),'utf8'),{context});
  if(name==='./preparation-failure.mjs')return new vm.SourceTextModule(await readFile(new URL('../../src/preparation-failure.mjs',import.meta.url),'utf8'),{context});
  if(name==='./login-policy.mjs')return new vm.SyntheticModule(['LoginPolicy'],function(){this.setExport('LoginPolicy',class {constructor(){throw Error('Unexpected manual policy in lease-only fixture');}});},{context});
  const values = adapters[name]; assert.ok(values, name);
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
});
await runtime.evaluate();
function call(method, url, value) {
  const response = { statusCode: 200, body: '', setHeader() {}, writeHead(status) { this.statusCode = status; }, end(body = '') { this.body = body; } };
  handler({ method, url, headers: { authorization: `Bearer ${token}`, 'x-oddpath-lease-ms': String(value) } }, response);
  return response;
}
if (scenario === 'closing') signals.SIGTERM();
if (scenario === 'expired') now = 11_001;
if (scenario === 'exact-expiry') now = 11_000;
if (scenario === 'deadline') now = 110_000;
const proposal = scenario === 'invalid-proposal' ? 110_001 : now + 20_000;
const accepted = scenario === 'valid';
assert.equal(call('POST', '/lease', proposal).statusCode, accepted ? 200 : 409);
for (const tick of intervals) tick();
const health = JSON.parse(call('GET', '/health').body);
assert.equal(health.leaseUntil, accepted ? proposal : 11_000);
assert.equal(health.status, accepted || scenario === 'invalid-proposal' ? 'LIVE' : 'STOPPING');
assert.equal(kills, accepted || scenario === 'invalid-proposal' ? 0 : 4);
if (health.status === 'STOPPING') {
  assert.equal(call('GET', '/cdp/json/version').statusCode, 409);
  let destroyed = false;
  upgrade({ url: '/cdp/devtools/browser/fixture', headers: { authorization: `Bearer ${token}` } }, { destroy() { destroyed = true; } }, Buffer.alloc(0));
  assert.equal(destroyed, true);
}
