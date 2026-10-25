import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assessRecovery} from '../recovery.mjs';
import {markRestoreQuarantined} from '../backup.mjs';
import {RECOVERY_DATABASE_MARKER} from '@oddpath/qa-execution-contract';

test('zero unresolved rows cannot authorize recovery without independent continuity',async()=>{
 const calls=[];const result=await assessRecovery({connect:async()=>({query:async q=>{calls.push(q);if(q.includes('pg_database'))return{rows:[{databaseName:'renamed',recoveryComment:RECOVERY_DATABASE_MARKER}]};if(q.includes('UsageEvent'))return{rows:[{reservedEvents:0,unknownEvents:0,settlementPendingEvents:0,unappliedReceipts:0,browserHolds:0}]};return{rows:[]};},end:async()=>calls.push('end')})});
 assert.equal(result.status,'RECOVERY_BLOCKED');assert.equal(result.releaseAuthorized,false);assert.equal(result.financialContinuity,'UNVERIFIED');assert.equal(result.deletionContinuity,'UNVERIFIED');assert.equal(result.revocationContinuity,'UNVERIFIED');assert.equal(result.physicalStop,'UNVERIFIED');assert.equal(result.inventoryAuthority,'HISTORICAL_SNAPSHOT_ONLY');assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.deepEqual(calls.slice(-2),['COMMIT','end']);
 assert(calls.every(q=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|GRANT|COMMENT)/.test(q)));
});
test('failed or live-source assessment cannot generate a successful inventory and closes connection',async()=>{
 for(const mode of ['live','disconnect','missing']){let closed=false,rolledBack=false;await assert.rejects(assessRecovery({connect:async()=>({query:async q=>{if(q==='ROLLBACK'){rolledBack=true;return;}if(q.includes('pg_database')){if(mode==='disconnect')throw Error('private database error');return{rows:mode==='missing'?[]:[{databaseName:'oddpath',recoveryComment:null}]};}return{rows:[]};},end:async()=>{closed=true;}})}));assert(closed);assert(rolledBack);}
});
test('restore fence cannot interpolate an arbitrary database identifier',async()=>{
 const queries=[];const client={query:async q=>queries.push(q)};
 await markRestoreQuarantined(client,'oddpath_restore_allowed1');assert.deepEqual(queries,[`COMMENT ON DATABASE "oddpath_restore_allowed1" IS '${RECOVERY_DATABASE_MARKER}'`]);
 for(const bad of ['oddpath','oddpath_restore_short','oddpath_restore_allowed1";DROP DATABASE oddpath;--'])await assert.rejects(markRestoreQuarantined(client,bad),/RESTORE_ISOLATED_TARGET_REQUIRED/);
 assert.equal(queries.length,1);
});
