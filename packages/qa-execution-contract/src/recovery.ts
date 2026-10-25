/** Database-level fence: survives database rename; never a promotion receipt. */
export const RECOVERY_DATABASE_MARKER = 'ODDPATH_RECOVERY_QUARANTINE_V1';
export const RECOVERY_DATABASE_QUERY = `SELECT current_database() AS "databaseName",
  shobj_description(oid, 'pg_database') AS "recoveryComment"
  FROM pg_database WHERE datname=current_database()`;

export interface RecoveryDatabaseState {
  databaseName: string;
  recoveryComment: string | null;
}

export function recoveryDatabaseState(rows: unknown): RecoveryDatabaseState {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
    || typeof rows[0].databaseName !== 'string' || !rows[0].databaseName
    || !(rows[0].recoveryComment === null || typeof rows[0].recoveryComment === 'string'))
    throw new Error('RESTORE_DATABASE_STATE_UNAVAILABLE');
  return rows[0] as RecoveryDatabaseState;
}

export function isRecoveryDatabase(state: RecoveryDatabaseState): boolean {
  // Include future marker versions and unmarked legacy restores. A changed
  // database name or feature flags cannot turn a historical DB into authority.
  return state.databaseName.startsWith('oddpath_restore_')
    || Boolean(state.recoveryComment?.includes('ODDPATH_RECOVERY_'));
}

export function assertOperationalDatabase(rows: unknown): void {
  if (isRecoveryDatabase(recoveryDatabaseState(rows)))
    throw new Error('RESTORE_DATABASE_QUARANTINED');
}
