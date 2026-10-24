import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import {requireOperationalDatabase} from '../db/recovery-guard.js';
import { browserRuntimeRepository } from '../modules/browser-runtime/browser-runtime.repository.js';
import { reapV2Executions } from '../modules/qa-requests/qa-execution.repository.js';
import { browserAuthRepository } from '../modules/browser-auth/browser-auth.repository.js';
import {closeBrowserAuthVault} from '../modules/browser-auth/browser-auth.vault.js';

if (!env.qaBrowserRuntimeEnabled) throw new Error('Browser runtime is disabled.');
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
try {
  await requireOperationalDatabase();
  while (!stopping) {
    try { await reapV2Executions(); await browserRuntimeRepository.reap();if(env.qaSavedLoginEnabled)await browserAuthRepository.cleanupExpired(); }
    catch { console.error('Browser API reaper pass failed; runtime watchdogs remain independent.'); }
    await delay(1_000);
  }
} finally { closeBrowserAuthVault();await prisma.$disconnect(); }
