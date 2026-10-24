import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runnerRegistrationV2Schema, targetDefinitionSchema } from '@oddpath/qa-execution-contract';
import { hashCanonicalJson } from '@oddpath/runner';
import { savedLoginRegistration, renewProjectRegistration } from '../src/project-registration.mjs';
import { claimManagedExecution } from '../src/project-claim.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(label = 'Customer portal') {
  const definition = targetDefinitionSchema.parse({ baseUrl: 'https://example.com', environmentKind: 'STAGING' });
  const manual = { schemaVersion: 2, profileKey: 'portal', label, authentication: { kind: 'MANUAL' },
    environmentKind: 'STAGING', evidenceKinds: ['TEXT'], recipeSchemaVersions: [1], executorKey: 'playwright', valueReferences: [],
    executionLimits: { preparationTimeoutMs: 300000, executionTimeoutMs: 600000 },
    target: { ...definition, revision: 1, revisionId: 'revision-1', targetId: 'target-1', targetHash: hashCanonicalJson(definition) } };
  const registration = runnerRegistrationV2Schema.parse({ schemaVersion: 2, instanceId: 'fixture', displayName: 'Fixture', executorKeys: ['playwright'],
    protocolVersions: [2], runnerVersion: 'test', profiles: [{ ...manual, manifestHash: hashCanonicalJson(manual) }] });
  const state = { id: '7d46deaa-eef4-47e0-829c-c853ce10dc0a', revision: 1, targetRevisionId: manual.target.revisionId,
    targetHash: manual.target.targetHash, revoked: false, expiresAt: new Date(Date.now() + 60000).toISOString() };
  return { projectId: 'project-1', registration, baseRegistration: structuredClone(registration), state };
}
const receipt = project => ({ projectId: project.projectId, registrationId: 'registration-1' });

it('waits for a published renewal acknowledgement before re-registering and claiming the new profile', async () => {
  const project = fixture(), committed = deferred(), acknowledge = deferred(), calls = [];
  let persisted = project.registration;
  project.client = {
    async savedLogins() { return { states: [project.state] }; },
    async registerV2(candidate) {
      persisted = structuredClone(candidate); calls.push(`register:${candidate.profiles.length}`);
      if (calls.length === 1) { committed.resolve(); await acknowledge.promise; }
      return receipt(project);
    },
    async claimV2() {
      calls.push('claim'); assert.equal(persisted.profiles.length, 2);
      assert.deepEqual(persisted, project.registration); return persisted.profiles[1];
    },
  };
  const renewal = renewProjectRegistration(project, true); await committed.promise;
  const claiming = claimManagedExecution(project); await settle();
  try { assert.deepEqual(calls, ['register:2']); assert.equal(project.registration.profiles.length, 1); }
  finally { acknowledge.resolve(); }
  await renewal; const claimed = await claiming;
  assert.equal(claimed.authentication.kind, 'SAVED_STATE'); assert.deepEqual(calls, ['register:2', 'register:2', 'claim']);
});

it('keeps renewal queued through both registration and the in-flight claim request', async () => {
  const project = fixture(), registered = deferred(), acknowledge = deferred(), claimed = deferred(), finish = deferred(), calls = [];
  project.client = {
    async registerV2(candidate) { calls.push(`register:${candidate.profiles.length}`); if (calls.length === 1) { registered.resolve(); await acknowledge.promise; } return receipt(project); },
    async claimV2() { calls.push('claim'); claimed.resolve(); await finish.promise; return null; },
    async savedLogins() { calls.push('saved'); return { states: [project.state] }; },
  };
  const claiming = claimManagedExecution(project); await registered.promise;
  const renewal = renewProjectRegistration(project, true); await settle(); assert.deepEqual(calls, ['register:1']);
  acknowledge.resolve(); await claimed.promise; await settle();
  try { assert.deepEqual(calls, ['register:1', 'claim']); }
  finally { finish.resolve(); }
  await claiming; await renewal; assert.deepEqual(calls, ['register:1', 'claim', 'saved', 'register:2']);
});

it('serializes two renewals from discovery through publication without stale snapshots', async () => {
  const project = fixture(), discovering = deferred(), finish = deferred(); let reads = 0;
  const published = [], next = { ...project.state, id: '7d46deaa-eef4-47e0-829c-c853ce10dc0b' };
  project.client = {
    async savedLogins() { if (++reads === 1) { discovering.resolve(); await finish.promise; return { states: [project.state] }; } return { states: [next] }; },
    async registerV2(candidate) { published.push(candidate.profiles[1].authentication.id); return receipt(project); },
  };
  const first = renewProjectRegistration(project, true); await discovering.promise;
  const second = renewProjectRegistration(project, true); await settle();
  try { assert.equal(reads, 1); }
  finally { finish.resolve(); }
  await Promise.all([first, second]); assert.deepEqual(published, [project.state.id, next.id]);
  assert.equal(project.registration.profiles[1].authentication.id, next.id);
});

it('releases a rejected renewal without losing the good cache or blocking a queued manual claim', async () => {
  const project = fixture(), entered = deferred(), fail = deferred(), original = project.registration;
  project.client = {
    async savedLogins() { entered.resolve(); await fail.promise; throw new Error('Discovery failed'); },
    async registerV2(candidate) { assert.strictEqual(candidate, original); return receipt(project); },
    async claimV2() { return 'manual-claim'; },
  };
  const rejected = assert.rejects(renewProjectRegistration(project, true), /Discovery failed/u); await entered.promise;
  const claiming = claimManagedExecution(project); fail.resolve(); await rejected;
  assert.equal(await claiming, 'manual-claim'); assert.strictEqual(project.registration, original);
});

it('does not block an unrelated configured project while one renewal awaits a response', async () => {
  const first = fixture(), second = fixture(), entered = deferred(), finish = deferred(); second.projectId = 'project-2';
  first.client = { async savedLogins() { entered.resolve(); await finish.promise; return { states: [] }; }, async registerV2() { return receipt(first); } };
  second.client = { async registerV2() { return receipt(second); }, async claimV2() { return 'independent'; } };
  const renewing = renewProjectRegistration(first, true); await entered.promise;
  try { assert.equal(await claimManagedExecution(second), 'independent'); }
  finally { finish.resolve(); await renewing; }
});

it('retains an unacknowledged candidate across repeated failures and only claims after confirming it', async () => {
  const project = fixture(), original = project.registration, calls = [];
  let publications = 0, claims = 0, discoveries = 0;
  project.client = {
    async savedLogins() { discoveries++; return { states: [project.state] }; },
    async registerV2(candidate) {
      calls.push(candidate.profiles.length);
      if (++publications <= 3) throw new Error('Acknowledgement lost');
      return receipt(project);
    },
    async claimV2() { claims++; return project.registration.profiles[1]; },
  };
  await assert.rejects(renewProjectRegistration(project, true), /Acknowledgement lost/u);
  assert.strictEqual(project.registration, original);
  await assert.rejects(claimManagedExecution(project), /Acknowledgement lost/u);
  assert.equal(claims, 0); assert.strictEqual(project.registration, original);
  await assert.rejects(renewProjectRegistration(project, true), /Acknowledgement lost/u);
  assert.equal(discoveries, 1); assert.equal(claims, 0);
  const claimed = await claimManagedExecution(project);
  assert.equal(claimed.authentication.kind, 'SAVED_STATE');
  assert.deepEqual(calls, [2, 2, 2, 2]); assert.equal(claims, 1);
});

it('reconciles unconfirmed publication before discovering and publishing a newer renewal', async () => {
  const project = fixture(), next = { ...project.state, id: '7d46deaa-eef4-47e0-829c-c853ce10dc0b' }, calls = [];
  let reads = 0, publications = 0;
  project.client = {
    async savedLogins() { calls.push('discover'); return { states: [++reads === 1 ? project.state : next] }; },
    async registerV2(candidate) {
      calls.push(candidate.profiles[1].authentication.id);
      if (++publications === 1) throw new Error('Acknowledgement lost');
      return receipt(project);
    },
  };
  await assert.rejects(renewProjectRegistration(project, true), /Acknowledgement lost/u);
  await renewProjectRegistration(project, true);
  assert.deepEqual(calls, ['discover', project.state.id, project.state.id, 'discover', next.id]);
  assert.equal(project.registration.profiles[1].authentication.id, next.id);
});

for (const [name, label] of [
  ['ASCII', 'A'.repeat(120)], ['Arabic', 'ع'.repeat(120)],
  ['complete emoji before boundary', 'A'.repeat(107) + '😀' + 'B'.repeat(11)],
  ['emoji crossing boundary', 'A'.repeat(108) + '😀' + 'B'.repeat(10)],
  ['all emoji', '😀'.repeat(60)],
]) it(`preserves well-formed ${name} labels and hashes within the 120-unit contract`, () => {
  const project = fixture(label), registration = savedLoginRegistration(project.registration, [project.state]);
  const saved = registration.profiles[1], { manifestHash, ...manifest } = saved;
  assert.equal(label.length, 120); assert.ok(saved.label.length <= 120); assert.ok(saved.label.isWellFormed());
  assert.equal(manifestHash, hashCanonicalJson(manifest)); assert.ok(saved.label.endsWith(' · 7d46deaa'));
  assert.equal(registration.profiles[0].label, label);
});
