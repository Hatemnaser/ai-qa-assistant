import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { signGrant, verifyGrant, requireLiveGrant } from './viewer-grants.mjs';

export function createViewerGateway({ journal, driver, signingKey, publicOrigin, frameOrigin = null, secure = true }) {
  if (frameOrigin) {
    const origin = new URL(frameOrigin);
    const fixture = !secure && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
    if (origin.origin !== frameOrigin || (origin.protocol !== 'https:' && !fixture) || frameOrigin === publicOrigin) throw new Error('Invalid viewer frame origin.');
  }
  const streams = new Set();
  function authorization(req, runtimeId) {
    const ticket = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('oddpath_view='))?.slice(13);
    const grant = verifyGrant(ticket, signingKey, Date.now(), 900_000);
    if (grant.runtimeId !== runtimeId) throw new Error('Viewer authorization invalid.');
    return { grant, row: requireLiveGrant(grant, journal) };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const nonce = randomBytes(16).toString('base64url');
    // noVNC decodes JPEG/PNG framebuffer rectangles through data: images.
    res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data:; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${frameOrigin || "'none'"}; form-action 'none'`);
    try {
      if (req.method === 'GET' && req.url === '/open') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><meta charset="utf-8"><title>Oddpath browser</title><script nonce="${nonce}">const ticket=location.hash.slice(1);history.replaceState(null,'','/open');fetch('/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})}).then(r=>r.ok?r.json():Promise.reject()).then(r=>location.replace(r.path)).catch(()=>{document.body.textContent='Browser unavailable';});</script>`); return;
      }
      if (req.method === 'POST' && req.url === '/open') {
        if (req.headers.origin !== publicOrigin || req.headers['content-type'] !== 'application/json') throw new Error('Origin invalid.');
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 2200) throw new Error('Request too large.'); }
        const grant = verifyGrant(JSON.parse(body).ticket, signingKey), row = requireLiveGrant(grant, journal);
        journal.consumeTicket(grant.nonce, grant.expiresAt);
        const cookieExpiry = Math.min(row.deadline, grant.mode === 'LOGIN' ? row.preparationDeadline : Date.now() + 900_000);
        const cookie = signGrant({ ...grant, expiresAt: cookieExpiry }, signingKey);
        res.setHeader('Set-Cookie', `oddpath_view=${cookie}; HttpOnly; SameSite=Strict; Path=/r/${row.runtime}/; Max-Age=${Math.max(1, Math.floor((cookieExpiry - Date.now()) / 1000))}${secure ? '; Secure' : ''}`);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: `/r/${row.runtime}/` })); return;
      }
      const match = /^\/r\/([a-f0-9-]{36})\/(.*)$/u.exec(req.url || '');
      if (!match || req.method !== 'GET') throw new Error('Unavailable.');
      const { grant, row } = authorization(req, match[1]);
      if (!match[2]) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oddpath browser</title><style nonce="${nonce}">body{margin:0;background:#111;color:white;font:14px sans-serif}#screen{height:calc(100dvh - 32px)}p{margin:8px}</style><p id="state">${grant.mode === 'LOGIN' ? 'Private sign-in — capture paused' : 'Browser view'}</p><div id="screen"></div><script type="module" nonce="${nonce}">import RFB from './viewer/core/rfb.js';const notify=state=>{if(${JSON.stringify(frameOrigin)}&&parent!==window)parent.postMessage({type:'oddpath-browser',state,runtimeId:${JSON.stringify(row.runtime)},mode:${JSON.stringify(grant.mode)}},${JSON.stringify(frameOrigin)});};const rfb=new RFB(document.querySelector('#screen'),location.origin.replace(/^http/,'ws')+location.pathname+'viewer/websockify');rfb.viewOnly=${grant.mode !== 'LOGIN'};rfb.scaleViewport=true;rfb.addEventListener('connect',()=>notify('connected'));rfb.addEventListener('disconnect',()=>{document.querySelector('#state').textContent='Browser disconnected';notify('disconnected');});</script>`); return;
      }
      // The gateway serves no CDP/control route, user-selected upstream, or
      // arbitrary path. Only noVNC's static modules/assets are reachable.
      if (!/^viewer\/(?:core|vendor|app)\/[A-Za-z0-9_./-]+$/u.test(match[2]) || match[2].includes('..')) throw new Error('Unavailable.');
      const endpoint = new URL(await driver.endpoint(row.runtime));
      requireLiveGrant(grant, journal);
      const upstream = request({ hostname: endpoint.hostname, port: endpoint.port, path: `/${match[2]}`, headers: { authorization: `Bearer ${row.token}` }, timeout: 3_000 }, response => {
        res.statusCode = response.statusCode || 502;
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        response.pipe(res);
      });
      upstream.on('error', () => { res.statusCode = 502; res.end(); }); upstream.on('timeout', () => upstream.destroy()); upstream.end();
    } catch { res.statusCode = 403; res.end('Browser unavailable'); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const match = /^\/r\/([a-f0-9-]{36})\/viewer\/websockify$/u.exec(req.url || '');
      if (!match || req.headers.origin !== publicOrigin) throw new Error('Unavailable.');
      const { grant, row } = authorization(req, match[1]), endpoint = new URL(await driver.endpoint(row.runtime));
      requireLiveGrant(grant, journal);
      const upstream = request({ hostname: endpoint.hostname, port: endpoint.port, path: '/viewer/websockify', headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': req.headers['sec-websocket-key'],
        'sec-websocket-version': '13', ...(req.headers['sec-websocket-protocol'] ? { 'sec-websocket-protocol': req.headers['sec-websocket-protocol'] } : {}),
        authorization: `Bearer ${row.token}`,
        'x-oddpath-viewer-mode': grant.mode,
        ...(grant.mode === 'LOGIN' ? { 'x-oddpath-login-epoch': grant.controlEpoch } : {}),
      }, timeout: 5_000 });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        try { requireLiveGrant(grant, journal); } catch { socket.destroy(); remote.destroy(); return; }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
        socket.pipe(remote); remote.pipe(socket);
        const entry = { socket, remote, grant }; streams.add(entry);
        socket.on('close', () => { streams.delete(entry); remote.destroy(); }); remote.on('close', () => socket.destroy());
        socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
      });
      upstream.on('response', response => { response.resume(); socket.destroy(); });
      upstream.on('timeout', () => { upstream.destroy(); socket.destroy(); });
      upstream.on('error', () => socket.destroy()); upstream.end();
    } catch { socket.destroy(); }
  });
  const guard = setInterval(() => {
    for (const entry of streams) try { if (entry.grant.expiresAt <= Date.now()) throw new Error(); requireLiveGrant(entry.grant, journal); }
    catch { entry.socket.destroy(); entry.remote.destroy(); streams.delete(entry); }
  }, 200);
  server.closeViewerStreams = () => { clearInterval(guard); for (const entry of streams) { entry.socket.destroy(); entry.remote.destroy(); } streams.clear(); };
  server.on('close', server.closeViewerStreams);
  return server;
}
