import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { LoginBoundary } from './login-boundary.mjs';
import { LoginPolicy } from './login-policy.mjs';
import { preparationDiagnostic } from './preparation-failure.mjs';

const token = process.env.ODDPATH_RUNTIME_TOKEN || '';
const deadline = Number(process.env.ODDPATH_DEADLINE_MS);
let leaseUntil = Number(process.env.ODDPATH_LEASE_MS);
if (!/^[a-f0-9]{64}$/u.test(token) || !Number.isSafeInteger(deadline)
  || deadline <= Date.now() || deadline > Date.now() + 900_000 || !Number.isSafeInteger(leaseUntil)
  || leaseUntil <= Date.now() || leaseUntil > deadline || process.getuid() === 0) throw new Error('Invalid runtime configuration.');
await mkdir('/home/browser/profile', { recursive: true });
const children = [];
const streams = new Set();
const manual = process.env.ODDPATH_MANUAL_LOGIN === '1';
const saved = process.env.ODDPATH_SAVED_LOGIN === '1';
if(manual&&saved)throw new Error('Ambiguous authentication mode.');
const boundary = new LoginBoundary({ manual: manual||saved, deadline, preparationDeadline: Number(process.env.ODDPATH_PREPARATION_DEADLINE_MS), executionTimeoutMs: Number(process.env.ODDPATH_EXECUTION_TIMEOUT_MS) });
const loginPolicy = manual||saved ? new LoginPolicy({ baseUrl: process.env.ODDPATH_LOGIN_TARGET_URL, authenticationOrigins: JSON.parse(process.env.ODDPATH_LOGIN_ORIGINS || '[]'), stop }) : null;
let closing = false;
function closeStreams() { for (const entry of streams) { entry.socket.destroy(); entry.remote.destroy(); } streams.clear(); }
function stop() {
  if (closing) return;
  closing = true;
  boundary.close(); closeStreams();
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  setTimeout(() => process.exit(0), 300).unref();
}
function start(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  children.push(child);
  child.once('error', stop); child.once('exit', stop);
  return child;
}
start('Xvfb', [':99', '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-ac']);
let displayReady = false;
for (let attempt = 0; attempt < 50 && !closing; attempt++) {
  try { displayReady = (await stat('/tmp/.X11-unix/X99')).isSocket(); } catch {}
  if (displayReady) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!displayReady || closing) { stop(); throw new Error('Browser display did not become ready.'); }
start('google-chrome-stable', ['--disable-setuid-sandbox', '--user-data-dir=/home/browser/profile',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--remote-allow-origins=http://127.0.0.1:9222',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-quic',
  '--disable-extensions', '--disable-component-update', '--disable-breakpad', '--disable-crash-reporter',
  '--proxy-server=http://egress:3128', '--proxy-bypass-list=<-loopback>',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE egress', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--window-size=1440,900', 'about:blank']);
// Input starts disabled. Only an authenticated, bounded preparation transition
// can enable it; handoff disables it before exposing CDP to the executor.
start('x11vnc', ['-display', ':99', '-localhost', '-rfbport', '5900', '-nopw', '-forever', '-shared', '-viewonly', '-noxdamage']);
start('websockify', ['--web=/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900']);
function authorized(req) {
  const provided = Buffer.from((req.headers.authorization || '').replace(/^Bearer /u, ''));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
function live(now = Date.now()) {
  if (now >= Math.min(deadline, leaseUntil) || !boundary.live()) stop();
  return !closing;
}
function rejectPreparation(res,error,stage){
  const failure=preparationDiagnostic(error,stage);
  stop();res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({failure}));
}
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) { res.writeHead(403); res.end(); return; }
  const now = Date.now(), isLive = live(now);
  if (req.method === 'POST' && req.url === '/lease') {
    const value = Number(req.headers['x-oddpath-lease-ms']);
    if (!isLive || !Number.isSafeInteger(value) || value <= now || value > deadline || value > now + 45_000) { res.writeHead(409); res.end(); return; }
    leaseUntil = value; res.end('{}'); return;
  }
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ status: closing ? 'STOPPING' : 'LIVE', deadline, leaseUntil, phase: boundary.phase })); return; }
  if (!isLive) { res.writeHead(409); res.end(); return; }
  if(req.method==='POST'&&['/auth/capture','/auth/restore'].includes(req.url)){
    const epoch=req.headers['x-oddpath-login-epoch'];
    try{
      if(!loginPolicy)throw new Error('Authentication unavailable.');
      if(req.url==='/auth/capture'){
        if(!manual||boundary.phase!=='READY'||boundary.epoch!==epoch)throw new Error('Capture unavailable.');
        const state=await loginPolicy.capture();if(!live())throw new Error('Authority expired.');
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));
      }else{
        if(!saved||boundary.phase!=='PREPARING')throw new Error('Restore unavailable.');
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)throw new Error('State exceeds its limit.');chunks.push(chunk);}const body=Buffer.concat(chunks).toString('utf8');
        if(!live())throw new Error('Authority expired.');
        boundary.begin(epoch);closeStreams();await loginPolicy.begin();if(!live())throw new Error('Authority expired.');
        await loginPolicy.restore(JSON.parse(body));if(!live())throw new Error('Authority expired.');
        boundary.handoff(epoch);boundary.ready(epoch);res.end(JSON.stringify({phase:boundary.phase}));
      }
    }catch(error){rejectPreparation(res,error,'STATE');}
    return;
  }
  if (req.method === 'POST' && ['/login/begin','/login/complete','/login/start'].includes(req.url)) {
    if (!loginPolicy) { res.writeHead(404); res.end(); return; }
    const epoch = req.headers['x-oddpath-login-epoch'];
    try {
      if(saved&&req.url!=='/login/start')throw new Error('Saved preparation does not grant human input.');
      if (req.url === '/login/begin' && !(boundary.phase === 'LOGIN' && boundary.epoch === epoch)) {
        boundary.begin(epoch); closeStreams(); await loginPolicy.begin();
        if (!live()) throw new Error('Login expired.');
        await loginPolicy.input(true); if (!live()) throw new Error('Login expired.');
      } else if (req.url === '/login/complete' && !(boundary.phase === 'READY' && boundary.epoch === epoch)) {
        boundary.handoff(epoch); closeStreams(); await loginPolicy.finish();
        if (!live()) throw new Error('Login expired.'); boundary.ready(epoch);
      } else if (req.url === '/login/start' && !(boundary.phase === 'EXECUTING' && boundary.epoch === epoch)) boundary.start(epoch);
      if (!live()) throw new Error('Login expired.');
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ phase: boundary.phase, executionDeadline: boundary.executionDeadline }));
    } catch(error) { rejectPreparation(res,error,'BOUNDARY'); }
    return;
  }
  const path = req.url || '';
  const cdp = path.startsWith('/cdp/');
  if (cdp && !boundary.allowsCdp() && !(boundary.phase === 'PREPARING' && path === '/cdp/json/version')) { res.writeHead(403); res.end(); return; }
  if (req.method !== 'GET' || !(cdp || path.startsWith('/viewer/'))) { res.writeHead(404); res.end(); return; }
  const upstream = request({ hostname: '127.0.0.1', port: cdp ? 9222 : 6080, path: path.replace(/^\/(cdp|viewer)/u, ''), headers: { host: '127.0.0.1:9222' } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); upstream.end();
});
server.on('upgrade', (req, socket, head) => {
  const permitted = () => live() && (req.url?.startsWith('/cdp/devtools/') ? boundary.allowsCdp()
    : req.url === '/viewer/websockify' && boundary.allowsViewer(req.headers['x-oddpath-viewer-mode'] || 'VIEW', req.headers['x-oddpath-login-epoch']));
  if (!authorized(req) || !permitted()) { socket.destroy(); return; }
  const cdp = req.url.startsWith('/cdp/');
  const headers = { ...req.headers, host: '127.0.0.1:9222' };
  delete headers.authorization;
  const upstream = request({ hostname: '127.0.0.1', port: cdp ? 9222 : 6080,
    path: req.url.replace(/^\/(cdp|viewer)/u, ''), headers });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    if (!permitted()) { socket.destroy(); remote.destroy(); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
    socket.pipe(remote); remote.pipe(socket); remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
    const entry = { socket, remote }; streams.add(entry);
    socket.on('close', () => { streams.delete(entry); remote.destroy(); }); remote.on('close', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
server.listen(8080, '0.0.0.0');
setInterval(live, 200);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
