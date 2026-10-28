import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CLOSED_RECOVERY_DATABASE_MARKER,isClosedRecoveryDatabase,isRecoveryDatabase,assertOperationalDatabase} from '../src/recovery.js';
const active={databaseName:'oddpath_recovered',recoveryComment:CLOSED_RECOVERY_DATABASE_MARKER+':bfe42d10-84be-4238-8000-416af250bd04'};
test('only exact closed activation provenance becomes operational',()=>{
 assert.equal(isClosedRecoveryDatabase(active),true);assert.equal(isRecoveryDatabase(active),false);assert.doesNotThrow(()=>assertOperationalDatabase([active]));
 for(const comment of [CLOSED_RECOVERY_DATABASE_MARKER,active.recoveryComment+' suffix','prefix '+active.recoveryComment,active.recoveryComment.replace('_V1','_V2')]){
  const state={...active,recoveryComment:comment};assert.equal(isClosedRecoveryDatabase(state),false);assert.throws(()=>assertOperationalDatabase([state]),/RESTORE_DATABASE_QUARANTINED/);
 }
});
test('an active comment cannot authorize a historical restore database name',()=>{
 const state={...active,databaseName:'oddpath_restore_anything'};assert.equal(isClosedRecoveryDatabase(state),false);assert.throws(()=>assertOperationalDatabase([state]),/RESTORE_DATABASE_QUARANTINED/);
});
