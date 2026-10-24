import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RECOVERY_DATABASE_QUERY,recoveryDatabaseState,isRecoveryDatabase} from '@oddpath/qa-execution-contract';
import {pgClient} from './backup.mjs';
import {requireCondition} from './lib/private-files.mjs';

/** Historical inventory only. No credentials, rows, estimates or promotion token. */
export async function assessRecovery({connect=pgClient}={}) {
  const client=await connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const database=recoveryDatabaseState((await client.query(RECOVERY_DATABASE_QUERY)).rows);
    requireCondition(isRecoveryDatabase(database),'RESTORE_QUARANTINED_TARGET_REQUIRED');
    const snapshotUsage=(await client.query(`SELECT
      (SELECT count(*)::int FROM "UsageEvent" WHERE status='reserved') AS "reservedEvents",
      (SELECT count(*)::int FROM "UsageEvent" WHERE status='unknown') AS "unknownEvents",
      (SELECT count(*)::int FROM "UsageEvent" WHERE status='settlement_pending') AS "settlementPendingEvents",
      (SELECT count(*)::int FROM "UsageSettlementReceipt" WHERE "appliedAt" IS NULL) AS "unappliedReceipts",
      (SELECT count(*)::int FROM "QaBrowserReservation" WHERE state<>'RELEASED') AS "browserHolds"`)).rows[0];
    await client.query('COMMIT');
    return {schemaVersion:1,status:'RECOVERY_BLOCKED',quarantined:true,releaseAuthorized:false,
      financialContinuity:'UNVERIFIED',deletionContinuity:'UNVERIFIED',revocationContinuity:'UNVERIFIED',
      physicalStop:'UNVERIFIED',inventoryAuthority:'HISTORICAL_SNAPSHOT_ONLY',snapshotUsage,
      requirements:['Trusted independent post-snapshot PostgreSQL continuity (e.g. verified WAL/PITR or a current quiesced source); a snapshot/hash/operator assertion is insufficient',
        'Reconcile confirmed receipts idempotently; preserve unknown consumption and active holds; never replay a provider or infer zero usage',
        'Reconcile account/asset deletions from current independent records without returning deleted data to users',
        'Prove current revocations or invalidate old saved-login generations; prove physical Stop without clearing historical creator fences',
        'Separate reviewed recovery/promotion and release gate; this command cannot authorize activation']};
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {await client.end().catch(()=>{});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{requireCondition(process.argv.length===3&&process.argv[2]==='assess','RESTORE_ASSESS_USAGE');console.log(JSON.stringify(await assessRecovery()));process.exitCode=2;}
  catch{console.error(JSON.stringify({status:'RECOVERY_ASSESSMENT_FAILED',releaseAuthorized:false}));process.exitCode=1;}
}
