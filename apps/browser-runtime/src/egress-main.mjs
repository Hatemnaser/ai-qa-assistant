import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { allowedHosts, resolveConnect } from './egress-policy.mjs';

const hosts = allowedHosts(JSON.parse(process.env.ODDPATH_ALLOWED_ORIGINS || '[]'));
const deadline = Number(process.env.ODDPATH_DEADLINE_MS);
if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 900_000) throw new Error('Invalid deadline.');
const sockets = new Set();
const server = createServer((_req, res) => { res.writeHead(403); res.end(); });
server.maxHeadersCount = 30;
server.maxConnections = 128; server.headersTimeout = 5_000; server.requestTimeout = 10_000;
server.on('connect', async (req, client, head) => {
  let upstream;
  // CONNECT hands us a raw socket. Fence its lifetime before the first await:
  // a reset during DNS/policy rejection must close this tunnel, not the proxy.
  client.on('error', () => { upstream?.destroy(); client.destroy(); });
  client.on('close', () => upstream?.destroy());
  try {
    if (Date.now() >= deadline || sockets.size >= 200) throw new Error('Unavailable.');
    const destination = await resolveConnect(req.url || '', hosts, host => lookup(host, { all: true, verbatim: true }));
    if (client.destroyed || Date.now() >= deadline) throw new Error('Unavailable.');
    upstream = connect({ host: destination.address, port: destination.port, timeout: 10_000 });
    sockets.add(upstream);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
      upstream.setTimeout(60_000);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
  } catch {
    upstream?.destroy();
    if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  }
});
server.on('clientError', (_error, socket) => socket.destroy());
server.listen(3128, '0.0.0.0');
setTimeout(() => process.exit(0), Math.max(1, deadline - Date.now()));
