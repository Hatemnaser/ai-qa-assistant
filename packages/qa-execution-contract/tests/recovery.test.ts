import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RECOVERY_DATABASE_MARKER,assertOperationalDatabase,recoveryDatabaseState} from '../src/recovery.js';

test('operational metadata is positive evidence; absent, ambiguous or malformed metadata is not',()=>{
  assert.doesNotThrow(()=>assertOperationalDatabase([{databaseName:'oddpath',recoveryComment:null}]));
  for(const rows of [null,[],[{},{}],[{}],[{databaseName:'',recoveryComment:null}],[{databaseName:'oddpath',recoveryComment:undefined}]])
    assert.throws(()=>assertOperationalDatabase(rows),/RESTORE_DATABASE_STATE_UNAVAILABLE/);
});
test('legacy names, persistent markers and future marker versions always quarantine',()=>{
  for(const row of [{databaseName:'oddpath_restore_old',recoveryComment:null},
    {databaseName:'renamed',recoveryComment:RECOVERY_DATABASE_MARKER},
    {databaseName:'renamed',recoveryComment:'ODDPATH_RECOVERY_QUARANTINE_V2'},
    {databaseName:'renamed',recoveryComment:'operator note: '+RECOVERY_DATABASE_MARKER}])
    assert.throws(()=>assertOperationalDatabase([row]),/RESTORE_DATABASE_QUARANTINED/);
  const input=[{databaseName:'renamed',recoveryComment:RECOVERY_DATABASE_MARKER}],copy=structuredClone(input);
  recoveryDatabaseState(input);assert.deepEqual(input,copy);
});
