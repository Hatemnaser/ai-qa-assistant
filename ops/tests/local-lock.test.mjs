import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalOperationsLock } from '../lib/local-lock.mjs';
test('backup lock rejects a second holder and is recoverable after the first handle exits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oddpath-lock-')),path=join(dir,'lock.sqlite');
 const first=new LocalOperationsLock(path),second=new LocalOperationsLock(path);
 try{
   await first.connect();await second.connect();assert.equal(await first.acquire(),true);assert.equal(await second.acquire(),false);
   await first.check();await first.end();first.db=undefined;assert.equal(await second.acquire(),true);await second.check();
 }finally{await first.end();await second.end();await rm(dir,{recursive:true,force:true});}
});
