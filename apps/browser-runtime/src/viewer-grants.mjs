import { createHmac, timingSafeEqual } from 'node:crypto';
import { browserAccessGrantSchema } from '@oddpath/qa-execution-contract';

export function signGrant(grant, key) {
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Dedicated viewer signing key required.');
  const payload = Buffer.from(JSON.stringify(browserAccessGrantSchema.parse(grant))).toString('base64url');
  return `${payload}.${createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('base64url')}`;
}
export function verifyGrant(ticket, key, now = Date.now(), maxTtl = 60_000) {
  if (typeof ticket !== 'string' || ticket.length > 2048 || !/^[a-f0-9]{64}$/u.test(key)) throw new Error('Viewer authorization invalid.');
  const parts = ticket.split('.');
  if (parts.length !== 2) throw new Error('Viewer authorization invalid.');
  const expected = createHmac('sha256', Buffer.from(key, 'hex')).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Viewer authorization invalid.');
  const grant = browserAccessGrantSchema.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
  if (grant.expiresAt <= now || grant.expiresAt > now + maxTtl) throw new Error('Viewer authorization expired.');
  return grant;
}
export function requireLiveGrant(grant, journal, now = Date.now()) {
  const row = journal.get(grant.executionId);
  if (!row || !['LIVE','EXECUTING'].includes(row.state) || row.runtime !== grant.runtimeId || row.project !== grant.projectId
    || row.binding !== grant.bindingHash || row.lease <= now || row.deadline <= now) throw new Error('Viewer runtime unavailable.');
  const phase = row.loginPhase || 'NONE';
  if (grant.mode === 'LOGIN' ? phase !== 'LOGIN' || row.loginEpoch !== grant.controlEpoch || row.preparationDeadline <= now
    : !['NONE','READY','EXECUTING'].includes(phase)) throw new Error('Viewer input authority unavailable.');
  return row;
}
