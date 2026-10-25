import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

async function runFixture(name, expectedTests) {
  const env = { ...process.env };
  // A nested --test invocation must start its own runner, not inherit the
  // parent's child-worker context and silently execute no fixture tests.
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--test',
    '--test-reporter=tap', '--test-timeout=20000',
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env, timeout: 30_000,
  });
  assert.match(stdout, new RegExp(`# tests ${expectedTests}\\r?\\n`, 'u'));
  assert.match(stdout, new RegExp(`# pass ${expectedTests}\\r?\\n`, 'u'));
}

it('registers through the real v2 service/client and reaches the supervisor claim with project binding', async () => {
  await runFixture('registration-contract.mts', 10);
});

it('serializes publication and claim through the real v2 service/client and execution repository', async () => {
  await runFixture('registration-concurrency.mts', 1);
});

it('reconciles committed registrations after real HTTP timeouts before claiming an approved saved profile', async () => {
  await runFixture('registration-timeout.mts', 2);
});
