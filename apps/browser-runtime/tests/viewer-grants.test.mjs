import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signGrant, verifyGrant, requireLiveGrant } from '../src/viewer-grants.mjs';
import { RuntimeJournal } from '../src/journal.mjs';

const now = Date.now(), key = 'a'.repeat(64), runtimeId = randomUUID();
const grant = { schemaVersion: 1, executionId: 'execution-1', runtimeId, ownerId: 'owner-1', projectId: 'project-1', bindingHash: 'b'.repeat(64), nonce: randomUUID(), expiresAt: now + 60_000, mode: 'VIEW' };
describe('owner-scoped browser viewer grants', () => {
  it('rejects forged signatures, expired tokens, and input-control grants', () => {
    const ticket = signGrant(grant, key); assert.deepEqual(verifyGrant(ticket, key, now), grant);
    assert.throws(() => verifyGrant(ticket, 'c'.repeat(64), now)); assert.throws(() => verifyGrant(ticket, key, now + 60_000));
    assert.throws(() => signGrant({ ...grant, mode: 'CONTROL' }, key));
  });
  it('consumes each short ticket once and fences cross-project/runtime/binding access', () => {
    const journal = new RuntimeJournal(':memory:', () => now);
    journal.reserve({ executionId: grant.executionId, runtimeId, token: 't', projectId: grant.projectId, bindingHash: grant.bindingHash, leaseUntil: now + 45_000, deadline: now + 600_000 }); journal.live(grant.executionId);
    journal.consumeTicket(grant.nonce, grant.expiresAt); assert.throws(() => journal.consumeTicket(grant.nonce, grant.expiresAt));
    requireLiveGrant(grant, journal, now);
    for (const invalid of [{ ...grant, projectId: 'other' },{ ...grant, executionId: 'other' },{ ...grant, runtimeId: randomUUID() },{ ...grant, bindingHash: 'c'.repeat(64) }]) assert.throws(() => requireLiveGrant(invalid, journal, now));
    journal.requestStop(grant.executionId); assert.throws(() => requireLiveGrant(grant, journal, now)); journal.close();
  });
});
