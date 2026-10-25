import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { RuntimeJournal } from '../src/journal.mjs';
import { BrowserSupervisor } from '../src/supervisor.mjs';

const writer = `
  const { DatabaseSync } = require('node:sqlite');
  const { workerData, parentPort } = require('node:worker_threads');
  const control = new Int32Array(workerData.shared);
  const db = new DatabaseSync(workerData.path);
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    parentPort.postMessage('locked');
    if (Atomics.load(control, 1) === 0) Atomics.wait(control, 1, 0, 5000);
    if (Atomics.load(control, 1) !== 1) throw new Error('Renewal never reached the locked journal.');
    // An old implementation samples time here. A fenced implementation cannot
    // read its clock until this writer releases the lock; the bounded wait lets
    // that implementation proceed too. Authority time itself is controlled.
    if (Atomics.load(control, 2) === 0) Atomics.wait(control, 2, 0, 150);
    Atomics.store(control, 3, Atomics.load(control, 2));
    Atomics.store(control, 0, workerData.afterWait);
    if (workerData.stop) db.prepare("UPDATE runtimes SET state='STOPPING',stopped=? WHERE execution=?")
      .run(workerData.afterWait, 'execution-1');
    db.exec('COMMIT');
  } finally { db.close(); }
`;

async function withLockedRenewal({ afterWait, lease = 11000, deadline = 100000, proposal = 30000, stop = false, dockerUnavailable = false }, check) {
  const directory = await mkdtemp(join(tmpdir(), 'oddpath-journal-lock-'));
  let journal, worker, completed;
  try {
    const path = join(directory, 'journal.sqlite');
    const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
    const control = new Int32Array(shared);
    Atomics.store(control, 0, 10000);
    let clockArmed = false;
    const now = () => Atomics.load(control, 0);
    journal = new RuntimeJournal(path, () => {
      const time = now();
      if (clockArmed) { Atomics.store(control, 2, 1); Atomics.notify(control, 2); }
      return time;
    });
    journal.reserve({ executionId: 'execution-1', runtimeId: 'runtime-1', projectId: 'project-1', bindingHash: 'b'.repeat(64), token: 'token', leaseUntil: lease, deadline });
    journal.live('execution-1');
    const calls = [];
    const supervisor = new BrowserSupervisor({ journal, now, driver: {
      async endpoint() { return 'http://runtime'; },
      async stop(id) {
        calls.push(['stop', id]);
        if (dockerUnavailable) throw new Error('Docker unavailable');
        return { processExited: true, observedAt: now() };
      }
    }, fetch: async () => { calls.push(['lease']); return { ok: true }; } });
    worker = new Worker(writer, { eval: true, workerData: { path, shared, afterWait, stop } });
    completed = once(worker, 'exit');
    completed.catch(() => {});
    assert.deepEqual(await once(worker, 'message'), ['locked']);
    const renew = journal.renew.bind(journal);
    journal.renew = (...args) => {
      clockArmed = true;
      Atomics.store(control, 1, 1); Atomics.notify(control, 1);
      return renew(...args);
    };
    let error;
    try { await supervisor.renew('execution-1', proposal); } catch (caught) { error = caught; }
    assert.deepEqual(await completed, [0]);
    // This proves the clock was sampled under the acquired lock, independently
    // of the eventual renewal outcome and host scheduling speed.
    assert.equal(Atomics.load(control, 3), 0, 'Renewal sampled time before acquiring the SQLite write lock.');
    assert.equal(now(), afterWait);
    assert.equal(calls.filter(call => call[0] === 'lease').length, 1);
    await check({ error, row: journal.get('execution-1'), calls });
  } finally {
    await worker?.terminate(); await completed?.catch(() => {});
    journal?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(directory, /oddpath-journal-lock-/u);
    await rm(directory, { recursive: true });
  }
}

for (const afterWait of [11000, 11001]) it(`rejects a lease that expires at ${afterWait} while waiting for a real SQLite writer and physically stops it`, async () => {
  await withLockedRenewal({ afterWait }, ({ error, row, calls }) => {
    assert.match(error?.message ?? '', /Runtime lease lost/u);
    assert.equal(row.lease, 11000);
    assert.equal(row.state, 'STOPPED');
    assert.equal(JSON.parse(row.proof).processExited, true);
    assert.deepEqual(calls.filter(call => call[0] === 'stop'), [['stop', 'runtime-1']]);
  });
});

it('commits a still-authorized renewal after waiting for the SQLite writer', async () => {
  await withLockedRenewal({ afterWait: 10500 }, ({ error, row, calls }) => {
    assert.equal(error, undefined);
    assert.equal(row.lease, 30000);
    assert.equal(row.state, 'LIVE');
    assert.equal(row.proof, null);
    assert.equal(calls.some(call => call[0] === 'stop'), false);
  });
});

it('does not overwrite a Stop committed by the SQLite writer during the wait', async () => {
  await withLockedRenewal({ afterWait: 10500, stop: true }, ({ error, row, calls }) => {
    assert.match(error?.message ?? '', /Runtime lease lost/u);
    assert.equal(row.lease, 11000);
    assert.equal(row.state, 'STOPPED');
    assert.equal(row.stopped, 10500);
    assert.deepEqual(calls.filter(call => call[0] === 'stop'), [['stop', 'runtime-1']]);
  });
});

it('rejects a hard deadline reached while waiting for the SQLite writer', async () => {
  await withLockedRenewal({ afterWait: 11000, lease: 12000, deadline: 11000 }, ({ error, row }) => {
    assert.ok(error);
    assert.equal(row.lease, 12000);
    assert.equal(row.state, 'STOPPED');
  });
});

it('rolls back an invalid proposal after the lock wait so Stop can still be persisted', async () => {
  await withLockedRenewal({ afterWait: 10500, proposal: 10500 }, ({ error, row }) => {
    assert.match(error?.message ?? '', /Runtime lease invalid/u);
    assert.equal(row.lease, 11000);
    assert.equal(row.state, 'STOPPED');
  });
});

it('keeps Stop unconfirmed when the lease expires under a SQLite lock and Docker is unavailable', async () => {
  await withLockedRenewal({ afterWait: 11001, dockerUnavailable: true }, ({ error, row, calls }) => {
    assert.match(error?.message ?? '', /Runtime lease lost/u);
    assert.equal(row.lease, 11000);
    assert.equal(row.state, 'STOPPING');
    assert.equal(row.proof, null);
    assert.deepEqual(calls.filter(call => call[0] === 'stop'), [['stop', 'runtime-1']]);
  });
});
