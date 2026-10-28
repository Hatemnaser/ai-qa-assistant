import {env} from '../config/env.js';
import {assertClosedRecoveryRuntime} from '../config/closed-browser.js';
import {assertOperationalDatabase,recoveryDatabaseState, RECOVERY_DATABASE_QUERY} from '@oddpath/qa-execution-contract';
import {prisma} from './prisma.js';

/** Check before listeners, workers or routine cleanup; no success cache/bypass. */
export async function requireOperationalDatabase() {
  let rows: unknown;
  try { rows = await prisma.$queryRawUnsafe(RECOVERY_DATABASE_QUERY); }
  catch { throw new Error('RESTORE_DATABASE_STATE_UNAVAILABLE'); }
  assertOperationalDatabase(rows);
  assertClosedRecoveryRuntime(recoveryDatabaseState(rows),env);
}
