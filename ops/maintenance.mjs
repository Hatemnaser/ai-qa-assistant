import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from '../apps/api/scripts/verify-release.mjs';
import { atomicJson, privateDirectory, requireCondition } from './lib/private-files.mjs';

const HOUR = 3_600_000;
export function jobManifest(env = process.env) {
  const role = env.ODDPATH_OPS_ROLE ?? 'maintenance';
  if (role === 'backup') {
    const scope=env.ODDPATH_BACKUP_SCOPE??'CLOSED_DATABASE_ONLY';
    requireCondition(['CLOSED_DATABASE_ONLY','FULL_SYSTEM'].includes(scope),'OPS_BACKUP_SCOPE_INVALID');
    return [
    { id: 'backup-retention', file: 'ops/backup.mjs', args: ['prune'], intervalMs: HOUR, timeoutMs: 60_000 },
    { id: scope==='FULL_SYSTEM'?'backup-full':'backup', file: scope==='FULL_SYSTEM'?'ops/full-backup.mjs':'ops/backup.mjs', scope, args: ['create'], intervalMs: 24 * HOUR, timeoutMs: 30 * 60_000 },
  ];
  }
  requireCondition(role === 'maintenance', 'OPS_INVALID_ROLE');
  const storage = ['R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].map(k => Boolean(env[k]));
  requireCondition(storage.every(Boolean) || storage.every(v => !v), 'OPS_PARTIAL_ASSET_CONFIGURATION');
  return [
    { id: 'usage', file: 'apps/api/dist/scripts/usage-reconcile.js', intervalMs: 60_000, timeoutMs: 45_000 },
    { id: 'retention', file: 'apps/api/dist/scripts/cleanup-retention.js', intervalMs: 15 * 60_000, timeoutMs: 120_000 },
    ...(storage.every(Boolean) ? [{ id: 'assets', file: 'apps/api/dist/scripts/cleanup-assets.js', intervalMs: 5 * 60_000, timeoutMs: 120_000 }] : []),
  ];
}

export function successfulCompletion(job, result) {
  if (result.code !== 0) return false;
  let events;
  try { events = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { return false; }
  if (job.id === 'retention') return events.some(e => e.event === 'retention_cleanup' && e.status === 'completed');
  if (job.id === 'assets') return events.some(e => e.event === 'asset_cleanup' && e.status === 'completed');
  if (job.id === 'usage') return events.some(e => Number.isSafeInteger(e.reconciled) && e.reconciled >= 0);
  if (job.id === 'backup-retention') return events.some(e => Number.isSafeInteger(e.expiredRemoved) && e.expiredRemoved >= 0);
  return ['backup','backup-full'].includes(job.id) && events.some(e => e.status === 'ENCRYPTED_BACKUP_VERIFIED' && e.scope === (job.scope??'CLOSED_DATABASE_ONLY'));
}

function hasUnresolvedFailure(saved) {
  // RUNNING replaces FAIL, so retain failure separately until verified success.
  // Legacy RUNNING records lack that distinction: fail closed for one retry.
  return saved.failurePending === true || saved.outcome === 'FAIL' ||
    (saved.outcome === 'RUNNING' && saved.failurePending !== false);
}

export function isHealthy(state, jobs, now = Date.now()) {
  return state?.schemaVersion === 1 && state.status === 'RUNNING' && Number.isFinite(state.heartbeatAt) &&
    now >= state.heartbeatAt && now - state.heartbeatAt < 45_000 && jobs.every(job => {
      const saved = state.jobs?.[job.id];
      return saved && !hasUnresolvedFailure(saved) && Number.isFinite(saved.lastSuccessAt) && now >= saved.lastSuccessAt &&
        now - saved.lastSuccessAt <= job.intervalMs + job.timeoutMs + 60_000;
    });
}

/** Fixed idempotent maintenance commands only. Never provider/QA dispatch. */
export async function supervise({ stateDirectory, env = process.env, signal, once = false, execute = runCommand,
  connect, now = Date.now, emit = line => console.log(JSON.stringify(line)) } = {}) {
  const jobs = jobManifest(env), role = env.ODDPATH_OPS_ROLE ?? 'maintenance';
  const directory = await privateDirectory(stateDirectory);
  const path = resolve(directory, 'status.json');
  let state;
  const work = new AbortController();
  const abort = () => work.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const config = role === 'maintenance' ? { connectionString: env.DATABASE_URL } : {
    host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE, user: env.PGUSER,
  };
  requireCondition(role !== 'maintenance' || Boolean(env.DATABASE_URL), 'OPS_DATABASE_REQUIRED');
  // The state lives on this host's filesystem. A PG disconnect releases its
  // advisory lock before this process finishes pending filesystem work. Keep
  // local publication ownership until every write has drained, for both roles.
  const stateLock = new (await import('./lib/local-lock.mjs')).LocalOperationsLock(resolve(directory,'supervisor.lock.sqlite'));
  const fileBacked = role === 'backup' && !connect;
  const client = fileBacked ? stateLock
    : (connect ?? (options => new Client(options)))({ ...config, application_name: `oddpath-ops-${role}`, connectionTimeoutMillis: 5000, query_timeout: 5000, keepAlive: true });
  let lockLost = false, acquired = false, stateOwned = false, timer;
  const lost = () => { lockLost = true; work.abort(); };
  client.on('error', lost); client.on('end', lost);
  let writes = Promise.resolve();
  const publicationAllowed = terminal => {
    requireCondition(stateOwned, 'OPS_LOCAL_LOCK_LOST');
    // After PG loss only a conservative terminal failure may be published,
    // still under the independent local fence. No successor can yet read/write.
    requireCondition(!lockLost || (terminal && state.status === 'FAILED' &&
      Object.values(state.jobs).every(job => job.failurePending === true)), 'OPS_DATABASE_LOCK_LOST');
  };
  const save = (terminal = false) => {
    const pending = writes.then(async () => {
      publicationAllowed(terminal); await stateLock.check(); publicationAllowed(terminal);
      await atomicJson(path, state, { beforeCommit: () => publicationAllowed(terminal) });
    });
    // Every caller observes its failure; retain a drainable queue for fenced
    // terminal failure reporting without leaving unhandled queued rejections.
    writes = pending.catch(() => {}); return pending;
  };
  const alert = (job, code) => {
    const event = { event: 'operations_failure', job, code, at: now() };
    state.alerts = [...state.alerts.slice(-199), event]; emit(event);
  };
  let heartbeat = Promise.resolve();
  try {
    await stateLock.connect(); stateOwned = await stateLock.acquire();
    requireCondition(stateOwned, 'OPS_ALREADY_RUNNING');
    if (!fileBacked) await client.connect();
    acquired = fileBacked || (await client.query("SELECT pg_try_advisory_lock(hashtext('oddpath_operations'),hashtext($1)) AS acquired", [role])).rows[0].acquired;
    // A second instance must not overwrite the active instance's heartbeat.
    requireCondition(acquired, 'OPS_ALREADY_RUNNING');
    // The prior owner may have committed a failure while this instance started.
    // Load authoritative jobs/alerts only while holding the exclusive lock.
    let previous;
    try { previous = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireCondition(!lockLost, 'OPS_DATABASE_LOCK_LOST');
    requireCondition(!work.signal.aborted, 'OPS_STARTUP_INTERRUPTED');
    state = { schemaVersion: 1, role, status: 'STARTING', heartbeatAt: now(), jobs: previous?.jobs ?? {}, alerts: previous?.alerts ?? [] };
    // A dead owner cannot finish its journal. Never reuse its recent PASS or
    // explicit RUNNING/false as evidence that an interrupted run recovered.
    for (const [id, saved] of Object.entries(state.jobs)) {
      if (previous.status === 'RUNNING' || saved.outcome === 'RUNNING')
        state.jobs[id] = { ...saved, failurePending: true, outcome: 'FAIL' };
    }
    state.status = 'RUNNING'; await save();
    timer = setInterval(() => {
      heartbeat = heartbeat.then(async () => {
        if (fileBacked) await client.check(); else await client.query('SELECT 1');
        requireCondition(!lockLost, 'OPS_DATABASE_LOCK_LOST');
        state.heartbeatAt = now(); await save();
      }).catch(() => { lockLost = true; work.abort(); });
    }, 10_000);
    do {
      for (const job of jobs) {
        if (work.signal.aborted) break;
        const saved = state.jobs[job.id] ?? {};
        const elapsed = now() - (saved.finishedAt ?? 0);
        if (!once && saved.finishedAt && elapsed >= 0 && elapsed < (saved.outcome === 'PASS' ? job.intervalMs : 60_000)) continue;
        state.jobs[job.id] = { ...saved, failurePending: hasUnresolvedFailure(saved), outcome: 'RUNNING', startedAt: now() }; await save();
        let ok = false;
        try {
          const result = await execute(process.execPath, [job.file, ...(job.args ?? [])], { env, timeoutMs: job.timeoutMs, signal: work.signal });
          ok = !lockLost && !work.signal.aborted && successfulCompletion(job, result);
          if (ok && job.id === 'usage') {
            const pending = await client.query('SELECT EXISTS(SELECT 1 FROM "UsageSettlementReceipt" WHERE "appliedAt" IS NULL) AS pending');
            ok = !pending.rows[0].pending;
          }
        } catch (error) {
          // An ungracefully killed backup child may leave private plaintext in
          // this container's tmpfs. Exit the daemon so restart clears that tmpfs.
          if (role === 'backup' && error.result && /timeout|output limit/.test(error.message)) { state.status = 'FAILED'; work.abort(); }
          // Raw child errors/output are never operational telemetry.
        }
        // Even a resolved result can represent SIGKILL. Any unsuccessful create
        // cannot prove its finally removed decrypted data. Exit this container;
        // its supervised restart clears private tmpfs before another attempt.
        if (role === 'backup' && ['backup','backup-full'].includes(job.id) && !ok) { state.status = 'FAILED'; work.abort(); }
        requireCondition(!lockLost, 'OPS_DATABASE_LOCK_LOST');
        state.jobs[job.id] = { ...state.jobs[job.id], failurePending: !ok, outcome: ok ? 'PASS' : 'FAIL', finishedAt: now(), ...(ok ? { lastSuccessAt: now() } : {}) };
        if (!ok) alert(job.id, work.signal.aborted ? 'INTERRUPTED' : 'JOB_FAILED_OR_INCOMPLETE');
        state.heartbeatAt = now(); await save();
      }
      if (!once && !work.signal.aborted) await delay(1000, undefined, { signal: work.signal }).catch(() => {});
    } while (!once && !work.signal.aborted);
    requireCondition(!lockLost, 'OPS_DATABASE_LOCK_LOST');
  } catch (error) {
    if (state) {
      state.status = 'FAILED';
      if (lockLost) for (const [id, saved] of Object.entries(state.jobs))
        state.jobs[id] = { ...saved, failurePending: true, outcome: 'FAIL' };
      alert('supervisor', 'SUPERVISION_FAILED');
    }
    throw error;
  } finally {
    clearInterval(timer); work.abort();
    try {
      await heartbeat;
      await writes;
      if (state) {
        if (lockLost) {
          state.status = 'FAILED';
          for (const [id, saved] of Object.entries(state.jobs))
            state.jobs[id] = { ...saved, failurePending: true, outcome: 'FAIL' };
        }
        if (state.status !== 'FAILED') state.status = signal?.aborted ? 'STOPPED' : once ? 'COMPLETED' : 'FAILED';
        state.heartbeatAt = now(); await save(true);
      }
    } finally {
      // A full/unwritable state volume must not strand the database socket and
      // advisory lock, keeping a failed Node process alive indefinitely.
      signal?.removeEventListener('abort', abort);
      client.removeListener('end', lost);
      await writes;
      try { if (!fileBacked) await client.end().catch(() => {}); }
      finally { stateOwned = false; await stateLock.end().catch(() => {}); }
    }
  }
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
  try {
    const args = process.argv.slice(2), dir = process.env.ODDPATH_OPS_STATE_DIRECTORY;
    if (args.length === 1 && args[0] === 'health') {
      requireCondition(Boolean(dir), 'OPS_STATE_DIRECTORY_REQUIRED');
      const state = JSON.parse(await readFile(resolve(dir, 'status.json'), 'utf8'));
      process.exitCode = isHealthy(state, jobManifest()) ? 0 : 1;
    } else {
      requireCondition(args.length === 1 && ['run', 'once'].includes(args[0]), 'OPS_USAGE_RUN_ONCE_HEALTH');
      const state = await supervise({ stateDirectory: dir, signal: controller.signal, once: args[0] === 'once' });
      if (Object.values(state.jobs).some(j => j.outcome === 'FAIL')) process.exitCode = 1;
    }
  } catch { console.error(JSON.stringify({ event: 'operations_failure', code: 'SUPERVISOR_FAILED' })); process.exitCode = 1; }
}
