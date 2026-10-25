import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import dotenv from 'dotenv';

export function connectionHost(args) {
  // Node may forward its normalized [options, callback] array internally.
  if (Array.isArray(args[0])) return connectionHost(args[0]);
  const first = args[0];
  if (first && typeof first === 'object') {
    if (first.path || !first.port) return null;
    return typeof first.host === 'string' ? first.host : 'localhost';
  }
  if (typeof first === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  return null;
}

export function isLoopbackConnection(args) {
  return ['127.0.0.1', '::1', 'localhost'].includes(connectionHost(args));
}

if (process.env.ODDPATH_RELEASE_NETWORK_GUARD === '1') {
  // Explicit test configuration only: never load a developer's .env into a
  // child process, including child workers and the Prisma CLI.
  dotenv.config = () => ({ parsed: {} });
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    if (!isLoopbackConnection(args)) {
      const error = new Error('ODDPATH_RELEASE_EGRESS_BLOCKED: only loopback TCP is allowed');
      error.code = 'ODDPATH_RELEASE_EGRESS_BLOCKED';
      throw error;
    }
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
}
