import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Reading the RFB greeting proves websockify can reach x11vnc, without sending
// any keyboard/mouse input or completing a viewer session.
function viewerGreeting(endpoint, token, timeout) {
  return new Promise((resolve, reject) => {
    let socket, finished = false, bytes = Buffer.alloc(0);
    const req = request(`${endpoint}/viewer/websockify`, { headers: {
      authorization: `Bearer ${token}`, connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-key': randomBytes(16).toString('base64'),
      'sec-websocket-version': '13', 'sec-websocket-protocol': 'binary',
    } });
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); socket?.destroy(); req.destroy();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Viewer is not ready.')), timeout);
    const consume = chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096) finish(new Error('Viewer greeting invalid.'));
      else if (bytes.includes(Buffer.from('RFB 003.008\n'))) finish();
    };
    req.on('upgrade', (_response, remote, head) => {
      socket = remote;
      remote.on('data', consume);
      remote.on('error', finish);
      remote.on('close', () => finish(new Error('Viewer disconnected before becoming ready.')));
      if (head.length) consume(head);
    });
    req.on('response', response => { response.resume(); finish(new Error('Viewer upgrade unavailable.')); });
    req.on('error', finish); req.end();
  });
}

export async function waitForBrowserServices(endpoint, token, notAfter, { now = () => Date.now(), http = fetch } = {}) {
  const remaining = () => {
    const value = notAfter - now();
    if (!Number.isSafeInteger(notAfter) || value <= 0) throw new Error('Browser startup authority or readiness deadline expired.');
    return Math.min(1000, value);
  };
  while (true) {
    remaining();
    try {
      const chrome = await http(`${endpoint}/cdp/json/version`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(remaining()) });
      if (!chrome.ok) { await chrome.body?.cancel(); throw new Error('Chrome is not ready.'); }
      const version = await chrome.json();
      if (typeof version.webSocketDebuggerUrl !== 'string' || !version.webSocketDebuggerUrl.startsWith('ws://')) throw new Error('Chrome is not ready.');
      const asset = await http(`${endpoint}/viewer/core/rfb.js`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(remaining()) });
      await asset.body?.cancel();
      if (!asset.ok) throw new Error('Viewer assets are not ready.');
      await viewerGreeting(endpoint, token, remaining());
      remaining(); // Expiry during any probe cannot authorize a late start.
      return;
    } catch {
      await delay(Math.min(100, remaining()));
    }
  }
}
