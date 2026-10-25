import { prisma } from '../db/prisma.js';
import { usageRepository } from '../modules/usage/usage.repository.js';
import {requireOperationalDatabase} from '../db/recovery-guard.js';

try {
  await requireOperationalDatabase();
  const reconciled=await usageRepository.reconcileExpiredUsage!({strict:true});
  console.log(JSON.stringify({reconciled}));
} finally { await prisma.$disconnect(); }
