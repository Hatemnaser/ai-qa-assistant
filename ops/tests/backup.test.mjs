import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupHeader, archiveName, encryptDump, decryptDump, dateFromArchiveName } from '../lib/backup-archive.mjs';
import { restoreTargetAllowed, pruneBackups } from '../backup.mjs';

async function fixture(fn) { const dir=await mkdtemp(join(tmpdir(),'oddpath-backup-test-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});} }
test('AEAD roundtrip stores no plaintext and authenticates metadata/content',async()=>fixture(async dir=>{
 const key=randomBytes(32),header=backupHeader(key),data=Buffer.from('synthetic-account-financial-receipt-'.repeat(10000)),path=join(dir,archiveName(header.metadata));
 await encryptDump(Readable.from([data]),path+'.part',path,key,{header});
 assert.equal((await readFile(path)).includes(data.subarray(0,80)),false);
 const decoded=join(dir,'decoded');assert.deepEqual(await decryptDump(path,decoded,key),header.metadata);assert.deepEqual(await readFile(decoded),data);
 for(const mutation of ['ciphertext','header','truncate','wrong-key']){
   const nested=join(dir,mutation);await mkdir(nested);const corrupted=join(nested,archiveName(header.metadata));
   const bytes=Buffer.from(await readFile(path));
   if(mutation==='ciphertext')bytes[bytes.length-20]^=1;
   if(mutation==='header') {const at=bytes.indexOf(Buffer.from(header.metadata.id));bytes[at]=bytes[at]===97?98:97;}
   await writeFile(corrupted,mutation==='truncate'?bytes.subarray(0,bytes.length-8):bytes);
   await assert.rejects(decryptDump(corrupted,join(nested,'invalid'),mutation==='wrong-key'?randomBytes(32):key));
 }
}));
test('exclusive publication cannot overwrite an existing archive',async()=>fixture(async dir=>{
 const key=randomBytes(32),header=backupHeader(key),path=join(dir,archiveName(header.metadata));
 await encryptDump(Readable.from(['first']),path+'.part',path,key,{header});const original=await readFile(path);
 await assert.rejects(encryptDump(Readable.from(['second']),path+'.second',path,key,{header}));assert.deepEqual(await readFile(path),original);
}));
test('seven-day retention has inclusive boundary and ignores unrelated names',async()=>fixture(async dir=>{
 const now=Date.parse('2026-10-19T12:00:00.000Z'),key=randomBytes(32),day=86_400_000;
 for(const [id,time]of [['expired',now-8*day],['boundary',now-7*day],['keep',now-7*day+1]]){
   const header=backupHeader(key,new Date(time));await writeFile(join(dir,archiveName(header.metadata)),id);
   assert.equal(dateFromArchiveName(archiveName(header.metadata)).getTime(),time);
 }
 await writeFile(join(dir,'do-not-remove.txt'),'unrelated');assert.equal(await pruneBackups(dir,now),2);
 const files=await readdir(dir);assert.ok(files.includes('.retention-lock.sqlite'));assert.equal(files.filter(n=>n!=='.retention-lock.sqlite').length,2);assert.equal(await readFile(join(dir,'do-not-remove.txt'),'utf8'),'unrelated');
 const old=backupHeader(key,new Date(now-8*day));await writeFile(join(dir,archiveName(old.metadata)+'.part'),'interrupted encrypted dump');
 assert.equal(await pruneBackups(dir,now),1);
}));
test('restore requires exact disposable target AND explicit acknowledgement',()=>{
 const name='oddpath_restore_0123456789';
 assert.equal(restoreTargetAllowed(name,name,'ISOLATED_EMPTY_TARGET'),true);
 for(const [db,confirm,ack]of [['oddpath','oddpath','ISOLATED_EMPTY_TARGET'],[name,'other','ISOLATED_EMPTY_TARGET'],[name,name,''],['oddpath_restore_../../live','x','ISOLATED_EMPTY_TARGET']])assert.equal(restoreTargetAllowed(db,confirm,ack),false);
});
test('concurrent retention passes remove only expired owned archives without false failures',async()=>fixture(async dir=>{
 const now=Date.now(),key=randomBytes(32);
 for(let i=0;i<2;i++){const h=backupHeader(key,new Date(now-8*86400000));await writeFile(join(dir,archiveName(h.metadata)),'synthetic expired encrypted file');}
 const removed=await Promise.all([pruneBackups(dir,now),pruneBackups(dir,now)]);assert.equal(removed[0]+removed[1],2);assert.deepEqual(await readdir(dir),['.retention-lock.sqlite']);
}));
