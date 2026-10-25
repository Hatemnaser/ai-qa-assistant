import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { releaseManifest, parseTapSummary, sanitizeOutput, ownsContainer, systemEnvironment, testEnvironment } from '../verify-release-manifest.mjs';
import { connectionHost, isLoopbackConnection } from '../verify-release-network.mjs';
import { assertUnchangedRealpath, checkedOutputDirectory, runCommand, verifyRelease } from '../verify-release.mjs';
import { changedFingerprintPaths, fingerprintSourceFiles, isReleaseInput } from '../verify-release-fingerprint.mjs';

const summary = (overrides = {}) => 'TAP version 13\n1..2\n' + Object.entries({ tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides }).map(([key, value]) => `# ${key} ${value}\n`).join('');

test('TAP requires complete, unambiguous exact coverage and no skipped/failing work', () => {
  assert.equal(parseTapSummary(summary(), 2).pass, 2);
  for (const field of ['fail', 'cancelled', 'skipped', 'todo']) assert.throws(() => parseTapSummary(summary({ [field]: 1 }), 2));
  assert.throws(() => parseTapSummary(summary({ tests: 0, pass: 0 }), 2));
  assert.throws(() => parseTapSummary(summary({ tests: 1, pass: 1 }), 2));
  assert.throws(() => parseTapSummary(summary().replace('# todo 0\n', ''), 2));
  assert.throws(() => parseTapSummary(summary() + '# tests 2\n', 2));
  assert.throws(() => parseTapSummary(summary() + 'Bail out! fixture interrupted\n', 2));
});

test('manifest does not double-run imports and keeps upgrade databases separate', () => {
  assert.equal(releaseManifest.length, 17);
  assert.deepEqual(releaseManifest.find(x=>x.id==='managed-routing'),{id:'managed-routing',file:'managed-routing.postgres.integration.ts',expectedTests:10});
  assert.deepEqual(releaseManifest.find(x=>x.id==='managed-routing-auth'),{id:'managed-routing-auth',file:'managed-routing-auth.postgres.integration.ts',expectedTests:2});
  assert.equal(new Set(releaseManifest.map(x => x.id)).size, releaseManifest.length);
  assert.equal(new Set(releaseManifest.map(x => x.file)).size, releaseManifest.length);
  assert.ok(!releaseManifest.some(x => x.file === 'quota-recovery.postgres.integration.ts'));
  assert.equal(releaseManifest.filter(x => x.upgradeFlag || x.emptyDatabase).length, 3);
  assert.ok(releaseManifest.every(x => Number.isInteger(x.expectedTests) && x.expectedTests > 0));
});

test('test environment rejects inherited secrets, database, proxy, preload and remote opt-in', () => {
  const inherited = { PATH: '/fixture/bin', SystemRoot: 'C:/Windows', DATABASE_URL: 'postgresql://real/production', GEMINI_API_KEY: 'live-key', SMTP_PASS: 'live-mail', R2_SECRET_ACCESS_KEY: 'storage', NODE_OPTIONS: '--require=untrusted', HTTPS_PROXY: 'https://proxy', ODDPATH_DB_INTEGRATION_ALLOW_REMOTE: '1', AI_ENABLED: 'true', DOCKER_HOST: 'ssh://remote' };
  assert.deepEqual(Object.keys(systemEnvironment(inherited)).sort(), ['PATH', 'SystemRoot']);
  const env = testEnvironment(inherited, { databaseUrl: 'postgresql://fixture/test', databaseName: 'release_test', guardUrl: 'file:///fixture/guard.mjs', upgradeFlag: 'ODDPATH_AUTH_UPGRADE_TEST' });
  assert.equal(env.DATABASE_URL, 'postgresql://fixture/test');
  assert.equal(env.GEMINI_API_KEY, ''); assert.equal(env.SMTP_PASS, '');
  assert.equal(env.AI_ENABLED, 'false'); assert.equal(env.ODDPATH_DB_INTEGRATION_ALLOW_REMOTE, '0');
  assert.equal(env.R2_SECRET_ACCESS_KEY, undefined); assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.NODE_OPTIONS, '--import=file:///fixture/guard.mjs');
  assert.equal(env.ODDPATH_AUTH_UPGRADE_TEST, '1');
});

test('redaction protects database URLs and generated credentials in logs and errors', () => {
  const text = sanitizeOutput('postgresql://postgres:password@127.0.0.1:2345/test?schema=public password', ['password']);
  assert.equal(text, '[REDACTED_DATABASE_URL] [REDACTED]');
});

test('source fingerprint binds content despite unchanged timestamps and ignores documentation', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'oddpath-release-source-'));
  try {
    await mkdir(resolve(fixture, 'apps/api/src'), { recursive: true });
    const path = 'apps/api/src/fixture.ts';
    await writeFile(resolve(fixture, path), 'const value = 1;');
    await writeFile(resolve(fixture, 'package.json'), '{"private":true}');
    const paths = [path, 'package.json', 'docs/status.md', 'apps/api/README.md'];
    const before = await fingerprintSourceFiles(fixture, paths), info = await stat(resolve(fixture, path));
    assert.equal(before.digest, (await fingerprintSourceFiles(fixture, [...paths].reverse())).digest);
    assert.equal(before.fileCount, 2); assert.equal(isReleaseInput('work/generated.ts'), false);
    assert.equal(isReleaseInput('.dockerignore'), true);
    await writeFile(resolve(fixture, path), 'const value = 2;');
    await utimes(resolve(fixture, path), info.atime, info.mtime);
    const after = await fingerprintSourceFiles(fixture, paths);
    assert.notEqual(after.digest, before.digest);
    assert.deepEqual(changedFingerprintPaths(before, after), [path]);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('cleanup requires the exact owned container name, token and ID', () => {
  const id = 'a'.repeat(64), owned = { Id: id, Name: '/fixture', Config: { Labels: { 'com.oddpath.release-run': 'token' } } };
  assert.equal(ownsContainer(owned, 'fixture', 'token', id), true);
  assert.equal(ownsContainer(owned, 'other', 'token', id), false);
  assert.equal(ownsContainer(owned, 'fixture', 'other', id), false);
  assert.equal(ownsContainer(owned, 'fixture', 'token', 'b'.repeat(64)), false);
  assert.equal(ownsContainer({}, 'fixture', 'token'), false);
});

test('network policy allows only loopback TCP argument forms and denies sockets/remote hosts', () => {
  for (const args of [[5432, '127.0.0.1'], [{ port: 5432, host: '::1' }], [{ port: 5432 }], [[{ port: 5432, host: 'localhost' }, () => {}]]]) assert.equal(isLoopbackConnection(args), true);
  for (const args of [[443, 'generativelanguage.googleapis.com'], [{ port: 443, host: '169.254.169.254' }], ['/var/run/docker.sock'], [{ path: '/fixture.sock' }], [{ fd: 42 }]]) assert.equal(isLoopbackConnection(args), false);
  assert.equal(connectionHost([123, 'localhost']), 'localhost');
});

test('real Node network preload blocks external TCP before any connection', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', new URL('../verify-release-network.mjs', import.meta.url).href, '--input-type=module', '-e', "import net from 'node:net';try{net.connect({host:'203.0.113.1',port:443});process.exitCode=2;}catch(e){if(e.code!=='ODDPATH_RELEASE_EGRESS_BLOCKED')throw e;console.log(e.code)}"], { env: { ...systemEnvironment(process.env), ODDPATH_RELEASE_NETWORK_GUARD: '1' }, windowsHide: true, timeout: 5_000 });
  assert.match(stdout, /ODDPATH_RELEASE_EGRESS_BLOCKED/);
});

test('preloaded test configuration never reloads provider secrets from dotenv', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'oddpath-release-env-'));
  try {
    await writeFile(resolve(fixture, '.env'), 'FIXTURE_PROVIDER_SECRET=must-not-be-loaded\n');
    const guard = new URL('../verify-release-network.mjs', import.meta.url).href;
    const code = `import {createRequire} from 'node:module';const dotenv=createRequire(${JSON.stringify(guard)})('dotenv');dotenv.config();if(process.env.FIXTURE_PROVIDER_SECRET)throw Error('dotenv was loaded');console.log('DOTENV_BLOCKED');`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', guard, '--input-type=module', '-e', code], { cwd: fixture, env: { ...systemEnvironment(process.env), ODDPATH_RELEASE_NETWORK_GUARD: '1' }, windowsHide: true, timeout: 5_000 });
    assert.match(stdout, /DOTENV_BLOCKED/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('opt-in is checked before output creation or any Docker access', async () => {
  await assert.rejects(verifyRelease({ acknowledgement: '0', outputDir: 'work/unused' }), /ODDPATH_RELEASE_LOCAL_TESTS/);
});

test('output is confined to work and mismatching resolved ancestry is rejected', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'oddpath-release-unit-'));
  try {
    await mkdir(resolve(fixture, 'work'));
    await assert.rejects(checkedOutputDirectory('docs/new', fixture), /new subdirectory/);
    await assert.rejects(checkedOutputDirectory('work', fixture), /new subdirectory/);
    assert.equal(await checkedOutputDirectory('work/run', fixture), resolve(fixture, 'work/run'));
    assertUnchangedRealpath(resolve(fixture, 'work/run'), resolve(fixture, 'work/run'));
    assert.throws(() => assertUnchangedRealpath(resolve(fixture, 'work/linked'), resolve(fixture, 'other')), /symlink or junction/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('owned child timeout is terminal, and ordinary exit status remains observable', async () => {
  const success = await runCommand(process.execPath, ['-e', "console.log('fixture')"], { env: systemEnvironment(process.env), timeoutMs: 5_000 });
  assert.equal(success.code, 0); assert.match(success.stdout, /fixture/);
  const failure = await runCommand(process.execPath, ['-e', 'process.exitCode=7'], { env: systemEnvironment(process.env), timeoutMs: 5_000 });
  assert.equal(failure.code, 7);
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: systemEnvironment(process.env), timeoutMs: 100 }), /timeout/);
});
