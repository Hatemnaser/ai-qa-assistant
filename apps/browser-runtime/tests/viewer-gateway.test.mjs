import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { RuntimeJournal } from '../src/journal.mjs';
import { createViewerGateway } from '../src/viewer-gateway.mjs';
import { signGrant } from '../src/viewer-grants.mjs';

it('serves only scoped noVNC assets, consumes tickets once and disconnects viewer sockets on Stop', { timeout: 10000 }, async () => {
  const journal = new RuntimeJournal(':memory:'), runtimeId = randomUUID(), key = 'a'.repeat(64), origin = 'https://viewer.example.com';
  const grant = { schemaVersion: 1, executionId: 'execution-view', runtimeId, ownerId: 'owner', projectId: 'project', bindingHash: 'b'.repeat(64), nonce: randomUUID(), expiresAt: Date.now() + 60000, mode: 'VIEW' };
  journal.reserve({ ...grant, runtimeId, token: 'secret-allocation', leaseUntil: Date.now() + 45000, deadline: Date.now() + 600000 }); journal.live(grant.executionId);
  const upstream = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer secret-allocation');
    assert.equal(req.url, '/viewer/core/rfb.js'); res.end('export default class RFB {}');
  });
  upstream.on('upgrade', (req, socket) => {
    assert.equal(req.url, '/viewer/websockify'); assert.equal(req.headers.authorization, 'Bearer secret-allocation');
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('error', () => {});
    socket.resume(); socket.on('end', () => socket.destroy());
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const driver = { async endpoint() { return `http://127.0.0.1:${upstream.address().port}`; } };
  const gateway = createViewerGateway({ journal, driver, signingKey: key, publicOrigin: origin });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${gateway.address().port}`;
  let viewer;
  try {
    const open = async (ticket, requestOrigin = origin) => fetch(base + '/open', { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) });
    const ticket = signGrant(grant, key);
    assert.equal((await open(ticket, 'https://other.example.com')).status, 403);
    const response = await open(ticket); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Strict/u); assert.match(cookie, /; Secure/u);
    assert.equal((await open(ticket)).status, 403);
    const headers = { cookie: cookie.split(';')[0] }, path = `/r/${runtimeId}/`;
    assert.equal((await fetch(base + path)).status, 403);
    assert.equal((await fetch(base + `/r/${randomUUID()}/`, { headers })).status, 403);
    assert.equal((await fetch(base + path + 'cdp/json/version', { headers })).status, 403);
    assert.equal((await fetch(base + path + 'viewer/core/rfb.js', { headers })).status, 200);
    const page = await fetch(base + path, { headers }); assert.match(await page.text(), /rfb.viewOnly=true/u);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
    viewer = await new Promise((resolve, reject) => {
      const upgrade = request(base + path + 'viewer/websockify', { headers: { ...headers, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': Buffer.alloc(16).toString('base64'), 'sec-websocket-version': '13' } });
      upgrade.once('upgrade', (_response, socket) => { socket.on('error', () => {}); resolve(socket); }); upgrade.once('error', reject); upgrade.end();
    });
    viewer.resume(); const closed = once(viewer, 'close'); journal.requestStop(grant.executionId); await closed;
    assert.equal((await fetch(base + path, { headers })).status, 403);
  } finally {
    viewer?.destroy(); gateway.closeViewerStreams(); gateway.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => upstream.close(resolve))]); journal.close();
  }
});

it('allows exactly one configured application frame origin while retaining viewer-only authority', async () => {
  const journal = new RuntimeJournal(':memory:'), runtimeId = randomUUID(), key = 'c'.repeat(64), origin = 'https://viewer.example.com', frameOrigin = 'https://app.example.com';
  for(const invalid of ['*','http://app.example.com',origin,'https://app.example.com/path','https://app.example.com https://evil.example'])assert.throws(()=>createViewerGateway({journal,driver:{},signingKey:key,publicOrigin:origin,frameOrigin:invalid}));
  const grant = {schemaVersion:1,executionId:'framed-execution',runtimeId,ownerId:'owner',projectId:'project',bindingHash:'b'.repeat(64),nonce:randomUUID(),expiresAt:Date.now()+60000,mode:'VIEW'};
  journal.reserve({...grant,token:'fixture',leaseUntil:Date.now()+45000,deadline:Date.now()+600000});journal.live(grant.executionId);
  const gateway=createViewerGateway({journal,driver:{},signingKey:key,publicOrigin:origin,frameOrigin});
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+gateway.address().port;
  try {
    const response=await fetch(base+'/open',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({ticket:signGrant(grant,key)})});
    assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
    const page=await fetch(base+`/r/${runtimeId}/`,{headers:{cookie}}),body=await page.text();
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors https:\/\/app.example.com; form-action 'none'/u);
    assert.match(body,/rfb.viewOnly=true/u);assert.match(body,/rfb.addEventListener\('connect'/u);
    assert.match(body,/type:'oddpath-browser'/u);assert.ok(body.includes(JSON.stringify(frameOrigin)));assert.ok(body.includes(JSON.stringify(runtimeId)));
    assert.ok(!body.includes('bindingHash'));
  } finally {gateway.closeViewerStreams();gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));journal.close();}
});
