import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, lstat, unlink, rmdir, realpath, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from '../apps/api/scripts/verify-release.mjs';
import { atomicJson, privateDirectory, readPrivate, requireCondition, syncDirectory } from './lib/private-files.mjs';
import { archiveName, backupHeader, encryptDump, decryptDump, dateFromArchiveName } from './lib/backup-archive.mjs';
import { LocalOperationsLock } from './lib/local-lock.mjs';
import {RECOVERY_DATABASE_MARKER,RECOVERY_DATABASE_QUERY,assertOperationalDatabase} from '@oddpath/qa-execution-contract';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
export function restoreTargetAllowed(database, confirmation, acknowledgement) {
  return /^oddpath_restore_[a-z0-9_]{8,45}$/.test(database ?? '') && confirmation === database && acknowledgement === 'ISOLATED_EMPTY_TARGET';
}

export function pgEnvironment(env) {
  requireCondition(['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSFILE','PGSSLMODE'].every(k => typeof env[k] === 'string' && env[k].length > 0), 'BACKUP_PG_CONFIGURATION_REQUIRED');
  requireCondition(/^\d{1,5}$/.test(env.PGPORT) && +env.PGPORT > 0 && +env.PGPORT <= 65535 && ['disable','verify-full'].includes(env.PGSSLMODE), 'BACKUP_PG_CONFIGURATION_INVALID');
  requireCondition(!env.PGPASSWORD && !env.PGSERVICE && !env.PGOPTIONS && !env.DATABASE_URL, 'BACKUP_DEDICATED_CREDENTIALS_REQUIRED');
  // No dotenv, provider keys or application signing keys enter PostgreSQL tools.
  return Object.fromEntries(Object.entries(env).filter(([k]) => ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSFILE','PGSSLMODE','PGSSLROOTCERT'].includes(k)));
}

export async function settings(env) {
  const directory = await privateDirectory(env.ODDPATH_BACKUP_DIRECTORY);
  const inside = relative(repo, directory);
  requireCondition(inside.startsWith('..') || isAbsolute(inside), 'BACKUP_OUTSIDE_CHECKOUT_REQUIRED');
  const encoded = (await readPrivate(env.ODDPATH_BACKUP_KEY_FILE, 128)).toString().trim();
  requireCondition(/^[a-f0-9]{64}$/.test(encoded), 'BACKUP_KEY_INVALID');
  await readPrivate(env.PGPASSFILE);
  return { directory, key: Buffer.from(encoded, 'hex'), pgEnv: pgEnvironment(env) };
}

export async function pgClient() {
  const client = new Client({ application_name: 'oddpath-backup', connectionTimeoutMillis: 5000, query_timeout: 10000 });
  client.on('error', () => {}); // Every operation checks its own connection/result.
  await client.connect(); return client;
}

export async function tool(command, args, env, signal, timeoutMs = 30 * 60_000) {
  const result = await runCommand(command, args, { env, signal, timeoutMs });
  requireCondition(result.code === 0, 'BACKUP_POSTGRES_TOOL_FAILED');
  return result;
}

export async function verifyBackup(archive, env = process.env, signal) {
  const config = await settings(env);
  requireCondition(await realpath(archive) === resolve(archive), 'BACKUP_SYMLINK_ARCHIVE');
  const temp = await mkdtemp(join(tmpdir(), 'oddpath-restore-'));
  const dump = join(temp, 'verified.dump');
  try {
    const metadata = await decryptDump(archive, dump, config.key, { signal });
    await tool('pg_restore', ['--list', dump], config.pgEnv, signal);
    return { metadata, dump, temp };
  } catch (error) { await unlink(dump).catch(() => {}); await rmdir(temp); throw error; }
}

async function removeVerified(verified) { await unlink(verified.dump); await rmdir(verified.temp); }

export async function pruneBackups(directory, now = Date.now()) {
  await privateDirectory(directory);
  const lock = new LocalOperationsLock(join(directory,'.retention-lock.sqlite'));
  await lock.connect();
  try {
    const deadline = Date.now() + 10_000;
    while (!await lock.acquire()) {
      requireCondition(Date.now() < deadline, 'BACKUP_RETENTION_LOCK_BUSY');
      await delay(20);
    }
  let removed = 0;
  for (const name of await readdir(directory)) {
    const time = dateFromArchiveName(name.endsWith('.opb.part') ? name.slice(0, -5) : name);
    if (!time || time.getTime() > now - 7 * DAY) continue;
    const path = join(directory, name);
    let info; try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    requireCondition(info.isFile() && !info.isSymbolicLink(), 'BACKUP_UNSAFE_RETENTION_ENTRY');
    try { await unlink(path); removed++; }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      // Windows can report EPERM while another unlink is pending. Ignore it
      // only after a fresh observation proves that the exact file is gone.
      if (process.platform === 'win32' && error.code === 'EPERM') {
        await delay(20);
        try { await lstat(path); } catch (missing) { if (missing.code === 'ENOENT') continue; }
      }
      throw error;
    }
  }
  if (removed) await syncDirectory(directory);
  return removed;
  } finally { await lock.end(); }
}

export async function createBackup(env = process.env, signal) {
  const config = await settings(env), controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  controller.signal.throwIfAborted();
  const client = await pgClient();
  const connectionLost = () => controller.abort(); client.on('error', connectionLost); client.on('end', connectionLost);
  const header = backupHeader(config.key), destination = join(config.directory, archiveName(header.metadata)), part = destination + '.part';
  let child, timer, published = false, authenticated = false;
  try {
    assertOperationalDatabase((await client.query(RECOVERY_DATABASE_QUERY)).rows);
    // One consistent snapshot covers the scope guard and every table/receipt.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope = await client.query(`SELECT
      EXISTS(SELECT 1 FROM "QaSavedBrowserState") OR EXISTS(SELECT 1 FROM "QaBrowserRuntime") OR
      EXISTS(SELECT 1 FROM "StoredAsset") OR EXISTS(SELECT 1 FROM "QaExecutionJob" WHERE status IN ('CLAIMED','RUNNING')) AS unsupported`);
    requireCondition(!scope.rows[0].unsupported, 'BACKUP_FULL_RUNTIME_OR_ASSET_TOPOLOGY_REQUIRED');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    requireCondition(/^[A-F0-9-]+$/i.test(snapshot), 'BACKUP_SNAPSHOT_INVALID');
    child = spawn('pg_dump', ['--format=custom','--no-owner','--no-acl',`--snapshot=${snapshot}`], { env: config.pgEnv, stdio: ['ignore','pipe','ignore'], windowsHide: true });
    const done = new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code) => code === 0 ? accept() : reject(new Error('BACKUP_DUMP_FAILED'))); });
    done.catch(() => {});
    const kill = () => child.kill('SIGKILL');
    controller.signal.addEventListener('abort', kill, { once: true });
    timer = setTimeout(() => controller.abort(), 30 * 60_000);
    try {
      await encryptDump(child.stdout, part, destination, config.key, { header, signal: controller.signal });
      published = true; await done;
    } catch (error) { kill(); await done.catch(() => {}); throw error; }
    finally { controller.signal.removeEventListener('abort', kill); }
    await client.query('COMMIT');
    const verified = await verifyBackup(destination, env, controller.signal); await removeVerified(verified); authenticated = true;
    const hash = createHash('sha256'); for await (const chunk of createReadStream(destination)) hash.update(chunk);
    const expiredRemoved = await pruneBackups(config.directory);
    const receipt = { schemaVersion: 1, status: 'ENCRYPTED_BACKUP_VERIFIED', scope: 'CLOSED_DATABASE_ONLY', id: header.metadata.id,
      createdAt: header.metadata.createdAt, archive: basename(destination), sha256: hash.digest('hex'), expiredRemoved,
      offHostCopyVerified: false, recoveryAuthorization: false };
    await atomicJson(join(config.directory,'backup-status.json'), receipt);
    return receipt;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Never leave a failed/partial archive under a successful-backup name.
    if (published && !authenticated) await unlink(destination).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); client.removeListener('end', connectionLost);
    await client.end().catch(() => {}); await unlink(part).catch(() => {});
  }
}

export async function requireIsolatedRestoreTarget(client, confirmation) {
    // Recovery ownership is exclusive: ordinary roles must neither CONNECT
    // effectively nor share the owner through any membership chain. MEMBER
    // deliberately also covers SET-only and mixed SET/INHERIT paths, even when
    // neither privileges nor SET ROLE to the final owner are directly available.
    // PostgreSQL superusers remain trusted administrators outside quarantine.
    const found = await client.query(`SELECT current_database() AS name,
      (SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_database WHERE datname=current_database()) AS owned,
      (SELECT NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.privilege_type='CONNECT' AND a.grantee<>d.datdba) FROM pg_database d WHERE d.datname=current_database()) AS private,
      (SELECT NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid<>d.datdba AND NOT r.rolsuper AND
        (has_database_privilege(r.oid,d.oid,'CONNECT') OR pg_has_role(r.oid,d.datdba,'MEMBER')))
        FROM pg_database d WHERE d.datname=current_database()) AS exclusive,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')) AS objects,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS others`);
    requireCondition(found.rows[0].name === confirmation && found.rows[0].owned && found.rows[0].private && found.rows[0].exclusive && found.rows[0].objects === 0 && found.rows[0].others === 0, 'RESTORE_TARGET_NOT_EMPTY_OR_ISOLATED');
}

/** Commit quarantine BEFORE pg_restore. Failure/restart cannot erase this fence. */
export async function markRestoreQuarantined(client, confirmation) {
  requireCondition(/^oddpath_restore_[a-z0-9_]{8,45}$/.test(confirmation), 'RESTORE_ISOLATED_TARGET_REQUIRED');
  await client.query(`COMMENT ON DATABASE "${confirmation}" IS '${RECOVERY_DATABASE_MARKER}'`);
}

export async function restoreBackup(archive, confirmation, env = process.env, signal) {
  requireCondition(restoreTargetAllowed(env.PGDATABASE, confirmation, env.ODDPATH_RESTORE_ACK), 'RESTORE_ISOLATED_TARGET_REQUIRED');
  const config = await settings(env);
  // Wrong keys, truncation or tampering fail before connecting to the target.
  const verified = await verifyBackup(archive, env, signal);
  let client;
  try {
    client = await pgClient();
    await requireIsolatedRestoreTarget(client, confirmation);
    await markRestoreQuarantined(client, confirmation);
    await tool('pg_restore', ['--exit-on-error','--single-transaction','--no-owner','--no-acl',`--dbname=${confirmation}`,verified.dump], config.pgEnv, signal);
    const receipt = { schemaVersion: 1, status: 'RESTORED_QUARANTINED', scope: verified.metadata.scope, backupId: verified.metadata.id,
      snapshotAt: verified.metadata.createdAt, restoredAt: new Date().toISOString(), releaseAuthorized: false, financialContinuity: 'UNVERIFIED',
      requirements: ['Keep restored deployment closed and isolated','Reconcile post-snapshot consumption/deletions against independent trusted evidence; never provider replay',
        'Preserve current independent revocations and confirm physical Stop before browser activation','Controlled migration/grant checks and current-build smoke','Separate independent recovery/release acceptance'] };
    await atomicJson(join(config.directory,'restore-status.json'), receipt);
    return receipt;
  } finally { await client?.end().catch(() => {}); await removeVerified(verified); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === 'create' && !args.length) result = await createBackup(process.env, controller.signal);
    else if (command === 'verify' && args.length === 1) {
      const verified = await verifyBackup(resolve(args[0]), process.env, controller.signal);
      result = { status: 'ARCHIVE_AUTHENTICATED', id: verified.metadata.id }; await removeVerified(verified);
    } else if (command === 'restore' && args.length === 3 && args[1] === '--confirm-target') result = await restoreBackup(resolve(args[0]), args[2], process.env, controller.signal);
    else if (command === 'prune' && !args.length) result = { expiredRemoved: await pruneBackups(await privateDirectory(process.env.ODDPATH_BACKUP_DIRECTORY)) };
    else throw new Error('BACKUP_USAGE_CREATE_VERIFY_RESTORE_PRUNE');
    console.log(JSON.stringify(result));
  } catch (error) {
    const safe = typeof error.code === 'string' && /^(?:BACKUP|RESTORE|OPS)_[A-Z_]+$/.test(error.code) ? error.code : 'BACKUP_OPERATION_FAILED';
    console.error(JSON.stringify({ status: 'FAILED', code: safe })); process.exitCode = 1;
  }
}
