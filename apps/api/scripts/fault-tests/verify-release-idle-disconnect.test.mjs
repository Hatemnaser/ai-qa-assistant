import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ownsContainer, systemEnvironment } from '../verify-release-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const exec = promisify(execFile);
const delay = ms => new Promise(done => setTimeout(done, ms));

async function docker(args) {
  return (await exec('docker', args, {
    env: systemEnvironment(process.env), timeout: 30_000,
    windowsHide: true, maxBuffer: 1024 * 1024,
  })).stdout;
}

test('idle PostgreSQL disconnect fails the real release CLI, saves evidence and removes its container', { timeout: 180_000 }, async () => {
  const outputDir = `work/release-fault-tests/idle-${randomUUID()}`;
  const outputPath = resolve(root, outputDir);
  const child = spawn(process.execPath, ['apps/api/scripts/verify-release.mjs', '--output-dir', outputDir], {
    cwd: root, env: { ...systemEnvironment(process.env), ODDPATH_RELEASE_LOCAL_TESTS: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '', exited = false, exitCode, owned, injected = false;
  child.stdout.resume();
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4096); });
  const closed = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', code => { exited = true; exitCode = code; done(); });
  });

  try {
    const deadline = Date.now() + 90_000;
    while (!injected && !exited && Date.now() < deadline) {
      await delay(100);
      let snapshot;
      try { snapshot = JSON.parse(await readFile(resolve(outputPath, 'verification.json'), 'utf8')); }
      catch { continue; }
      if (snapshot.preparation !== 'PASS' || snapshot.suites[0].status !== 'RUNNING') continue;
      for (const receipt of snapshot.commands) {
        let inspected;
        try { inspected = JSON.parse(await readFile(resolve(outputPath, receipt.log), 'utf8')); }
        catch { continue; }
        if (Array.isArray(inspected)) {
          owned ??= inspected.find(item =>
            item.Config?.Labels?.['com.oddpath.release-run'] &&
            item.Name === `/oddpath-release-test-${item.Config.Labels['com.oddpath.release-run']}`);
        }
      }
      assert.ok(owned, 'Expected this invocation to have an inspected owned container');
      const token = owned.Config.Labels['com.oddpath.release-run'];
      const current = JSON.parse(await docker(['inspect', owned.Id]))[0];
      assert.ok(ownsContainer(current, `oddpath-release-test-${token}`, token, owned.Id));
      const terminated = await docker([
        'exec', owned.Id, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid <> pg_backend_pid() AND state='idle'",
      ]);
      injected = terminated.trim() === 't';
    }
    assert.equal(injected, true, 'Could not terminate the owned idle administrative connection');
    await Promise.race([closed, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Release CLI did not terminate after PostgreSQL disconnect')), 60_000);
      timeout.unref();
      closed.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
    })]);
    const evidence = JSON.parse(await readFile(resolve(outputPath, 'verification.json'), 'utf8'));
    const remaining = (await docker(['ps', '-aq', '--filter', `label=com.oddpath.release-run=${owned.Config.Labels['com.oddpath.release-run']}`])).trim();
    assert.equal(exitCode, 1);
    assert.equal(stderr.includes("Unhandled 'error' event"), false, 'The Pool error escaped the verifier');
    assert.equal(evidence.status, 'FAIL');
    assert.match(evidence.error, /PostgreSQL administrative connection lost/);
    assert.ok(evidence.finishedAt);
    assert.equal(evidence.cleanup.ownedContainerRemoved, true);
    assert.equal(evidence.suites[0].status, 'FAIL');
    assert.equal(evidence.phaseAccepted, false);
    assert.equal(evidence.publicReleaseAuthorized, false);
    assert.equal(remaining, '', 'An owned PostgreSQL container remained after failure');
  } finally {
    if (!exited) { child.kill(); await closed; }
    // A broken gate must not leave its disposable container after this test.
    if (owned) {
      try {
        const current = JSON.parse(await docker(['inspect', owned.Id]))[0];
        const token = owned.Config.Labels['com.oddpath.release-run'];
        assert.ok(ownsContainer(current, `oddpath-release-test-${token}`, token, owned.Id));
        await docker(['rm', '--force', current.Id]);
      } catch (error) {
        if (!/no such object/i.test(String(error.stderr ?? ''))) throw error;
      }
    }
  }
});
