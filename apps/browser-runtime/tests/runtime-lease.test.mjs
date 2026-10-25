import { it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

for (const scenario of ['valid', 'expired', 'exact-expiry', 'closing', 'deadline', 'invalid-proposal']) {
  it(`checks the actual runtime lease handler before the watchdog: ${scenario}`, async () => {
    await promisify(execFile)(process.execPath, ['--experimental-vm-modules',
      fileURLToPath(new URL('./fixtures/runtime-lease.mjs', import.meta.url)), scenario], { timeout: 10_000 });
  });
}
