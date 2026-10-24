import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import {requireOperationalDatabase} from '../db/recovery-guard.js';
import { invalidateQueuedLegacyExecutions } from '../modules/qa-requests/qa-execution.repository.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--invalidate-queued-legacy')) throw new Error('Unknown transition option.');
try {
  await requireOperationalDatabase();
  if (args.includes('--invalidate-queued-legacy')) {
    if (env.qaLegacyRunnerDispatchEnabled || env.qaExecutionV2Enabled) throw new Error('Disable both dispatch modes on every API instance before the operator transition.');
    console.log(JSON.stringify({ invalidated: await invalidateQueuedLegacyExecutions() }));
  }
  const [active, queuedLegacy] = await Promise.all([
    prisma.qaExecutionJob.count({ where: { status: { in: ['CLAIMED','RUNNING'] } } }),
    prisma.qaExecutionJob.count({ where: { protocolVersion: 1, status: 'QUEUED' } }),
  ]);
  console.log(JSON.stringify({ active, queuedLegacy, legacyDispatchEnabled: env.qaLegacyRunnerDispatchEnabled, protocolDrained: active === 0 && queuedLegacy === 0 }));
} finally { await prisma.$disconnect(); }
