import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { releaseManifest, ownsContainer, parseTapSummary, sanitizeOutput, systemEnvironment, testEnvironment } from './verify-release-manifest.mjs';
import { changedFingerprintPaths, fingerprintSourceFiles } from './verify-release-fingerprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const api = resolve(root, 'apps/api');
const guardUrl = new URL('./verify-release-network.mjs', import.meta.url).href;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

export function assertUnchangedRealpath(expected, actual) {
  if (relative(expected, actual) !== '') throw new Error('Evidence path contains a symlink or junction');
}

export async function checkedOutputDirectory(input, repoRoot = root) {
  if (!input) throw new Error('Specify --output-dir within the ignored repository work/ directory');
  const work = resolve(repoRoot, 'work'), directory = resolve(repoRoot, input);
  const inside = (parent, child) => { const r = relative(parent, child); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
  if (!inside(work, directory)) throw new Error('Evidence must be in a new subdirectory of repository work/');
  let ancestor = directory;
  for (;;) {
    try {
      const actual = await realpath(ancestor), actualRoot = await realpath(repoRoot);
      const expected = resolve(actualRoot, relative(repoRoot, ancestor));
      assertUnchangedRealpath(expected, actual);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(ancestor);
      if (next === ancestor) throw error;
      ancestor = next;
    }
  }
  await mkdir(directory, { recursive: true });
  return directory;
}

async function stopChild(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolveStop => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env: systemEnvironment(process.env) });
      const timer = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolveStop(); }, 5_000);
      const done = () => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); resolveStop(); };
      killer.once('error', done); killer.once('close', done);
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export async function runCommand(command, args, { env, cwd = root, timeoutMs = 300_000, signal } = {}) {
  if (signal?.aborted) throw new Error('Local release verification interrupted');
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, reason, stopping;
    const stop = message => {
      reason ??= message;
      stopping ??= stopChild(child).catch(() => {});
    };
    const abort = () => stop('Local release verification interrupted');
    const timer = setTimeout(() => stop('Command exceeded the release verification timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    for (const [stream, append] of [[child.stdout, value => { stdout += value; }], [child.stderr, value => { stderr += value; }]]) {
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) { stop('Command exceeded the output limit'); return; }
        append(chunk.toString());
      });
    }
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.once('error', error => { finish(); reject(error); });
    child.once('close', async (code, childSignal) => {
      finish(); await stopping;
      if (reason) reject(Object.assign(new Error(reason), { result: { code, signal: childSignal, stdout, stderr } }));
      else resolveRun({ code, signal: childSignal, stdout, stderr });
    });
  });
}

export async function waitForPostgresReady(execute, containerId) {
  for (let i = 0; i < 60; i++) {
    // The image's initdb server accepts Unix sockets before initialization
    // completes. Only the final server exposes the TCP transport used below.
    if ((await execute('docker', ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], { timeoutMs: 5_000 })).code === 0) return;
    await sleep(500);
  }
  throw new Error('Disposable PostgreSQL did not become ready');
}

export async function verifyRelease({ outputDir, acknowledgement = process.env.ODDPATH_RELEASE_LOCAL_TESTS, signal } = {}) {
  if (acknowledgement !== '1') throw new Error('Set ODDPATH_RELEASE_LOCAL_TESTS=1 to run owned disposable local release tests');
  const directory = await checkedOutputDirectory(outputDir);
  if ((await readdir(directory)).length) throw new Error('Output directory must be empty; existing evidence is never overwritten');
  const token = randomUUID(), name = `oddpath-release-test-${token}`, password = randomBytes(32).toString('hex');
  const env = systemEnvironment(process.env), secrets = [password];
  const evidence = {
    schemaVersion: 1, scope: 'LOCAL_POSTGRES_HTTP_SMTP_MIGRATION_REGRESSIONS',
    status: 'RUNNING', phaseAccepted: false, publicReleaseAuthorized: false,
    startedAt: new Date().toISOString(), manifest: releaseManifest,
    suites: releaseManifest.map(entry => ({ id: entry.id, status: 'NOT_RUN' })),
    commands: [],
    cleanup: { ownedContainerRemoved: false },
    limitations: ['Not a full verify/build/audit or deployed release gate', 'No native ARM, browser Docker, public TLS/SMTP or off-host restore certification', 'The Node TCP guard is defense in depth, not an OS network sandbox'],
  };
  let containerId, pool, failure, poolFailure, containerAttempted = false, evidenceCreated = false;
  const workController = new AbortController();
  const onExternalAbort = () => workController.abort();
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  const requireActive = () => {
    if (poolFailure) throw poolFailure;
    if (signal?.aborted) throw new Error('Local release verification interrupted');
  };
  const execute = async (command, args, options = {}) => {
    const receipt = { id: `command-${String(evidence.commands.length + 1).padStart(3, '0')}`, executable: basename(command), startedAt: new Date().toISOString() };
    let result;
    try {
      result = await runCommand(command, args, { env, signal: workController.signal, ...options });
      receipt.code = result.code; receipt.signal = result.signal; receipt.status = result.code === 0 ? 'PASS' : 'FAIL';
      return result;
    } catch (error) {
      result = error.result ?? { stdout: '', stderr: error.message };
      const commandError = Object.hasOwn(options, 'signal') && options.signal === undefined ? error : poolFailure ?? error;
      receipt.status = 'ERROR'; receipt.error = sanitizeOutput(commandError.message, secrets);
      throw commandError;
    } finally {
      if (evidenceCreated) {
        receipt.finishedAt = new Date().toISOString(); receipt.log = `${receipt.id}.log`;
        const contents = sanitizeOutput((result?.stdout ?? '') + '\n' + (result?.stderr ?? ''), secrets);
        await writeFile(resolve(directory, receipt.log), contents, { mode: 0o600 });
        receipt.logHash = createHash('sha256').update(contents).digest('hex');
        evidence.commands.push(receipt);
      }
    }
  };
  const must = async (command, args, options) => {
    const result = await execute(command, args, options);
    if (result.code !== 0) throw new Error(`Verification prerequisite failed: ${sanitizeOutput(result.stderr || result.stdout, secrets)}`);
    return result;
  };
  const save = () => writeFile(resolve(directory, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  const log = (id, result) => writeFile(resolve(directory, `${id}.log`), sanitizeOutput(result.stdout + '\n' + result.stderr, secrets), { mode: 0o600 });
  const fingerprint = async suffix => {
    const listing = await must('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    const snapshot = await fingerprintSourceFiles(root, listing.stdout.split('\0').filter(Boolean));
    await writeFile(resolve(directory, `source-fingerprint.${suffix}.json`), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
    return snapshot;
  };
  try {
    const ignored = await execute('git', ['check-ignore', '--quiet', resolve(directory, 'verification.json')]);
    if (ignored.code !== 0) throw new Error('Evidence output is not ignored by Git');
    await writeFile(resolve(directory, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    evidenceCreated = true;
    const head = await must('git', ['rev-parse', 'HEAD']); evidence.gitHead = head.stdout.trim();
    evidence.manifestHash = createHash('sha256').update(JSON.stringify(releaseManifest)).digest('hex');
    const sourceBefore = await fingerprint('before');
    evidence.sourceBefore = { digest: sourceBefore.digest, fileCount: sourceBefore.fileCount, file: 'source-fingerprint.before.json' };
    const context = (await must('docker', ['context', 'show'], { timeoutMs: 15_000 })).stdout.trim();
    const endpoint = JSON.parse((await must('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], { timeoutMs: 15_000 })).stdout);
    if (typeof endpoint !== 'string' || !/^(unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/.test(endpoint)) throw new Error('A local Docker Unix socket or Windows named pipe is required');
    if ((await must('docker', ['info', '--format', '{{.OSType}}'], { timeoutMs: 30_000 })).stdout.trim() !== 'linux') throw new Error('Linux Docker is required');
    containerAttempted = true;
    const created = await must('docker', ['run', '--detach', '--pull=never', '--name', name, '--label', `com.oddpath.release-run=${token}`, '--memory', '512m', '--cpus', '1', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=512m', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=postgres', '--env', 'POSTGRES_USER=postgres', 'postgres:16', '-c', 'shared_buffers=64MB', '-c', 'max_wal_size=128MB', '-c', 'min_wal_size=32MB'], { env: { ...env, POSTGRES_PASSWORD: password }, timeoutMs: 60_000 });
    containerId = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Docker did not return an owned container ID');
    const inspect = JSON.parse((await must('docker', ['inspect', name])).stdout)[0];
    if (!ownsContainer(inspect, name, token, containerId)) throw new Error('Disposable PostgreSQL ownership could not be verified');
    const bindings = inspect.NetworkSettings?.Ports?.['5432/tcp'];
    if (bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || !/^\d+$/.test(bindings[0].HostPort)) throw new Error('PostgreSQL must have exactly one loopback port binding');
    const port = Number(bindings[0].HostPort);
    if (port < 1 || port > 65535) throw new Error('Invalid disposable PostgreSQL port');
    await waitForPostgresReady(execute, containerId);
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`, connectionTimeoutMillis: 5_000, query_timeout: 15_000, statement_timeout: 15_000, max: 1 });
    pool.on('error', error => {
      poolFailure ??= new Error(`Disposable PostgreSQL administrative connection lost (${error.code ?? 'UNKNOWN'})`);
      workController.abort();
    });
    const identity = (await pool.query("SELECT current_database() AS db, current_setting('server_version_num') AS version")).rows[0];
    requireActive();
    if (identity.db !== 'postgres' || Number(identity.version) < 160000 || Number(identity.version) >= 170000) throw new Error('Expected owned PostgreSQL 16 admin database');
    evidence.postgresVersion = identity.version;
    const preparationEnv = testEnvironment(process.env, { databaseUrl: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres?schema=public`, databaseName: 'postgres', guardUrl });
    for (const [id, args, cwd] of [
      ['contract-build', [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], resolve(root, 'packages/qa-execution-contract')],
      ['prisma-generate', [resolve(root, 'node_modules/prisma/build/index.js'), 'generate', '--no-hints'], api],
    ]) {
      const prepared = await execute(process.execPath, args, { env: preparationEnv, cwd, timeoutMs: 120_000 });
      requireActive();
      await log(id, prepared);
      if (prepared.code !== 0) throw new Error(`${id} failed; see its sanitized log`);
    }
    evidence.preparation = 'PASS';
    for (const [index, entry] of releaseManifest.entries()) {
      requireActive();
      const result = evidence.suites[index], databaseName = `oddpath_release_test_${token.replaceAll('-', '').slice(0, 12)}_${index}`;
      const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${databaseName}?schema=public`;
      const childEnv = testEnvironment(process.env, { databaseUrl, databaseName, guardUrl, upgradeFlag: entry.upgradeFlag });
      result.status = 'RUNNING'; result.startedAt = new Date().toISOString(); await save();
      let databaseCreated = false;
      try {
        await pool.query(`CREATE DATABASE "${databaseName}"`);
        databaseCreated = true;
        requireActive();
        if (!entry.upgradeFlag && !entry.emptyDatabase) {
          const migration = await execute(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: api, env: childEnv, timeoutMs: 120_000 });
          requireActive();
          await log(`${entry.id}-migrations`, migration);
          if (migration.code !== 0) throw new Error(`Migration failed for ${entry.id}; see its sanitized log`);
        }
        const tested = await execute(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=60000', '--test-reporter=tap', `apps/api/tests/${entry.file}`], { env: childEnv, timeoutMs: 300_000 });
        requireActive();
        await log(entry.id, tested);
        if (tested.code !== 0 || tested.signal) throw new Error(`Suite ${entry.id} failed; see its sanitized log`);
        result.summary = parseTapSummary(tested.stdout, entry.expectedTests);
        result.logHash = createHash('sha256').update(await readFile(resolve(directory, `${entry.id}.log`))).digest('hex');
        result.status = 'PASS';
      } catch (error) { result.status = 'FAIL'; result.error = sanitizeOutput(error.message, secrets); throw error; }
      finally {
        result.finishedAt = new Date().toISOString();
        if (databaseCreated) await pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        await save();
      }
    }
    const sourceAfter = await fingerprint('after');
    requireActive();
    evidence.sourceAfter = { digest: sourceAfter.digest, fileCount: sourceAfter.fileCount, file: 'source-fingerprint.after.json' };
    evidence.changedInputPaths = changedFingerprintPaths(sourceBefore, sourceAfter);
    if (sourceAfter.digest !== sourceBefore.digest) throw new Error('Maintained release inputs changed during verification; rerun on a stable Working Tree');
    requireActive();
    evidence.status = 'PASS_LOCAL_SUITES';
  } catch (error) {
    failure = poolFailure ?? error; evidence.status = poolFailure ? 'FAIL' : signal?.aborted ? 'INTERRUPTED' : 'FAIL';
    evidence.error = sanitizeOutput(failure.message, secrets);
    for (const suite of evidence.suites.filter(entry => entry.status === 'RUNNING')) {
      suite.status = 'FAIL'; suite.error = evidence.error; suite.finishedAt = new Date().toISOString();
    }
  } finally {
    await pool?.end().catch(() => {});
    // Inspect again immediately before removal. A coincidental name is not ownership.
    if (!containerAttempted) {
      evidence.cleanup.notCreated = true;
      evidence.cleanup.ownedContainerRemoved = true;
    } else try {
      const inspected = await execute('docker', ['inspect', name], { signal: undefined, timeoutMs: 15_000 });
      if (inspected.code === 0) {
        const owned = JSON.parse(inspected.stdout)[0];
        if (!ownsContainer(owned, name, token, containerId)) throw new Error('Refusing to remove a container without exact ownership proof');
        const removed = await execute('docker', ['rm', '--force', owned.Id], { signal: undefined, timeoutMs: 30_000 });
        if (removed.code !== 0) throw new Error('Owned PostgreSQL cleanup failed');
        evidence.cleanup.ownedContainerRemoved = true;
      } else if (containerId && inspected.stderr.includes(`No such object: ${name}`)) {
        evidence.cleanup.ownedContainerRemoved = true;
        evidence.cleanup.alreadyAbsent = true;
      } else throw new Error('Cannot establish whether the owned container still exists');
    } catch (error) { evidence.cleanup.error = sanitizeOutput(error.message, secrets); }
    if (!evidence.cleanup.ownedContainerRemoved) { evidence.status = 'FAIL'; failure ??= new Error('Owned PostgreSQL cleanup could not be confirmed'); }
    if (poolFailure) {
      failure = poolFailure; evidence.status = 'FAIL'; evidence.error = sanitizeOutput(poolFailure.message, secrets);
    }
    evidence.finishedAt = new Date().toISOString();
    if (evidenceCreated) await save();
    signal?.removeEventListener('abort', onExternalAbort);
  }
  if (failure) throw new Error(`${sanitizeOutput(failure.message, secrets)}; sanitized evidence: ${resolve(directory, 'verification.json')}`);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output-dir') throw new Error('Usage: node apps/api/scripts/verify-release.mjs --output-dir work/<new-run>');
    const evidence = await verifyRelease({ outputDir: args[1], signal: controller.signal });
    console.log(JSON.stringify({ status: evidence.status, suites: evidence.suites.length, publicReleaseAuthorized: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
