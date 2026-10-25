import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runCommand, waitForPostgresReady } from '../verify-release.mjs';
import { systemEnvironment } from '../verify-release-manifest.mjs';

test('release readiness waits for final TCP server, never the temporary initdb socket', { timeout: 90000 }, async () => {
  const token = randomUUID(), name = `oddpath-startup-test-${token}`;
  const directory = resolve('work/release-fault-tests', `startup-${token}`);
  await mkdir(directory, { recursive: true });
  // Deterministically hold the entrypoint's socket-only server open. No host bind mount.
  const script = resolve(directory, 'hold.sql');
  await writeFile(script, 'SELECT pg_sleep(8);\n');
  const env = { ...systemEnvironment(process.env), POSTGRES_PASSWORD: randomUUID() };
  const command = (binary, args, options) => runCommand(binary, args, { env, timeoutMs: 30000, ...options });
  const docker = args => command('docker', args);
  let id;
  try {
    const created = await docker(['create','--pull=never','--name',name,'--label',`com.oddpath.startup-test=${token}`,
      '--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m',
      '--env','POSTGRES_PASSWORD','postgres:16']);
    assert.equal(created.code, 0); id = created.stdout.trim(); assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal((await docker(['cp',script,`${id}:/docker-entrypoint-initdb.d/hold.sql`])).code, 0);
    assert.equal((await docker(['start',id])).code, 0);
    let socketReady = false;
    for (let i=0;i<40;i++) {
      socketReady = (await docker(['exec',id,'pg_isready','-U','postgres'])).code === 0;
      if (socketReady) break;
      await new Promise(done=>setTimeout(done,100));
    }
    assert.equal(socketReady,true,'Fixture must reach its temporary Unix socket');
    const tcp = () => docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);
    assert.notEqual((await tcp()).code,0,'Fixture must still be initializing');
    await waitForPostgresReady(command,id);
    assert.equal((await tcp()).code,0,'Readiness returned before TCP was available');
  } finally {
    if (id) {
      const inspected = await docker(['inspect',id]);
      const info = JSON.parse(inspected.stdout)[0];
      assert.equal(info.Id,id); assert.equal(info.Name,`/${name}`);
      assert.equal(info.Config.Labels['com.oddpath.startup-test'],token);
      assert.equal((await docker(['rm','--force',id])).code,0);
    }
  }
});
