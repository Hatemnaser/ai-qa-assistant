import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { waitForBrowserServices } from '../src/browser-readiness.mjs';
import { DockerRuntimeDriver } from '../src/docker-driver.mjs';

async function fixture(check) {
  const state = { chrome: true, asset: true, vnc: true, upgrades: 0, assets: 0, sockets: new Set() };
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token');
    if (req.url === '/cdp/json/version') {
      res.writeHead(state.chrome ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/fixture' }));
    } else {
      assert.equal(req.url, '/viewer/core/rfb.js'); state.assets++;
      res.writeHead(state.asset ? 200 : 502); res.end('export default class RFB {}');
    }
  });
  server.on('upgrade', (req, socket) => {
    assert.equal(req.headers.authorization, 'Bearer test-token'); assert.equal(req.url, '/viewer/websockify');
    state.upgrades++; state.sockets.add(socket);
    socket.on('error', () => {}); socket.on('close', () => state.sockets.delete(socket));
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (state.vnc) { socket.write(Buffer.from([0x82, 12])); socket.write('RFB 003.008\n'); state.onGreeting?.(); }
    else socket.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`, state); }
  finally {
    for (const socket of state.sockets) socket.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

it('waits for delayed noVNC assets instead of accepting only Chrome readiness', async () => {
  await fixture(async (endpoint, state) => {
    state.asset = false;
    let ready = false;
    const attempt = waitForBrowserServices(endpoint, 'test-token', Date.now() + 2000).then(() => { ready = true; });
    while (!state.assets) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(ready, false); assert.equal(state.upgrades, 0);
    state.asset = true; await attempt; assert.equal(ready, true); assert.equal(state.upgrades, 1);
  });
});
it('requires the RFB greeting even when Chrome and noVNC modules are ready', async () => {
  await fixture(async (endpoint, state) => {
    state.vnc = false;
    await assert.rejects(waitForBrowserServices(endpoint, 'test-token', Date.now() + 250), /deadline expired/u);
    assert.ok(state.upgrades > 0);
  });
});
it('accepts a split RFB greeting and closes its probe connection', async () => {
  await fixture(async (endpoint, state) => {
    await waitForBrowserServices(endpoint, 'test-token', Date.now() + 2000);
    assert.equal(state.upgrades, 1);
  });
});
it('refuses Chrome startup failure within the authority deadline', async () => {
  await fixture(async (endpoint, state) => {
    state.chrome = false;
    await assert.rejects(waitForBrowserServices(endpoint, 'test-token', Date.now() + 250), /deadline expired/u);
    assert.equal(state.assets, 0); assert.equal(state.upgrades, 0);
  });
});
it('rejects expiry after the final probe instead of returning a late readiness', async () => {
  await fixture(async (endpoint, state) => {
    let clock = Date.now(); const notAfter = clock + 2000;
    state.onGreeting = () => { clock = notAfter; };
    await assert.rejects(waitForBrowserServices(endpoint, 'test-token', notAfter, { now: () => clock }), /deadline expired/u);
    assert.equal(state.upgrades, 1);
  });
});
it('requests cleanup when the supervisor readiness command fails', async () => {
  const image = `sha256:${'a'.repeat(64)}`, now = Date.now(); let stopped = 0;
  const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
    execute: async args => {
      if (args[0] === 'version') return '29.0.0';
      if (args[0] === 'exec') throw new Error('Readiness failed.');
      return '';
    } });
  driver.endpoint = async () => 'http://172.20.1.2:8080';
  driver.stop = async runtime => { assert.equal(runtime, 'runtime'); stopped++; };
  await assert.rejects(driver.start({ executionId: 'execution', runtimeId: 'runtime', token: 'a'.repeat(64), origins: ['https://example.com'], deadline: now + 60000, leaseUntil: now + 45000 }), /Readiness failed/u);
  assert.equal(stopped, 1);
});
