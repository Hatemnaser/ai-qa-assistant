import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {encodeComponents,decodeComponents} from '../lib/backup-components.mjs';
import {backupHeader,archiveName,encryptDump,decryptDump,dateFromArchiveName} from '../lib/backup-archive.mjs';
import {pruneBackups} from '../backup.mjs';
import {snapshotSqlite,inspectSqlite,verifyRevocations} from '../lib/backup-sqlite.mjs';
import {createKeyEscrow,restoreKeyEscrow} from '../full-backup.mjs';
import {RuntimeJournal} from '../../apps/browser-runtime/src/journal.mjs';
import {backupObjectSource} from '../lib/backup-objects.mjs';
import {jobManifest,successfulCompletion,isHealthy} from '../maintenance.mjs';
import {runSqliteExporter} from '../sqlite-export.mjs';

async function fixture(fn){const directory=await mkdtemp(join(tmpdir(),'oddpath-full-test-'));try{await fn(directory);}finally{assert(resolve(directory).startsWith(resolve(tmpdir())));await rm(directory,{recursive:true,force:true});}}
async function packed(entries){const data=[];for await(const chunk of encodeComponents(entries))data.push(chunk);return Buffer.concat(data);}
const stream=(name,bytes)=>({name,stream:Readable.from([bytes])});

test('framing roundtrip is bounded across chunk boundaries and preserves binary bytes',()=>fixture(async dir=>{
 const data=randomBytes(150000),path=join(dir,'packed'),output=join(dir,'out');await mkdir(output,{mode:0o700});
 await writeFile(path,await packed([stream('postgres.dump',data),stream('objects/00000000.bin',Buffer.from([0,10,255,0]))]));
 const files=await decodeComponents(path,output);assert.equal(files.length,2);assert.equal(files[0].bytes,data.length);assert.deepEqual(await readFile(join(output,'postgres.dump')),data);
 assert.deepEqual(await readFile(join(output,'objects/00000000.bin')),Buffer.from([0,10,255,0]));
}));
test('component encoder refuses traversal, duplicates, arbitrary absolute files and key extensions',async()=>{
 for(const name of ['../live.sqlite','/tmp/live','objects/../../live','keys/provider.env','objects\\00000000.bin'])await assert.rejects(packed([stream(name,'secret')]),/BACKUP_COMPONENT_NAME_INVALID/);
 await assert.rejects(packed([stream('runtime.sqlite','a'),stream('runtime.sqlite','b')]),/BACKUP_COMPONENT_NAME_INVALID/);
});
test('component decoder rejects hash mismatch, truncation, oversized frame and trailing content',()=>fixture(async dir=>{
 const original=await packed([stream('postgres.dump',Buffer.from('receipt-value'))]);
 for(const kind of ['hash','truncated','oversized','trailing']){
  const data=Buffer.from(original),out=join(dir,kind);await mkdir(out,{mode:0o700});
  if(kind==='hash')data[data.indexOf(Buffer.from('receipt-value'))]^=1;
  if(kind==='oversized')data.writeUInt32BE(65537,data.indexOf(Buffer.from('{"name":"postgres.dump"}\n'))+Buffer.byteLength('{"name":"postgres.dump"}\n'));
  const changed=kind==='truncated'?data.subarray(0,data.length-7):kind==='trailing'?Buffer.concat([data,Buffer.from('untrusted')]):data;
  const file=join(dir,kind+'.packed');await writeFile(file,changed);await assert.rejects(decodeComponents(file,out),/BACKUP_COMPONENT_/);
 }
}));
test('decoder validates hostile names independently of its own encoder',()=>fixture(async dir=>{
 const path=join(dir,'bad'),out=join(dir,'out');await mkdir(out,{mode:0o700});
 await writeFile(path,'ODDPATH_COMPONENTS_V1\n{"name":"../escaped"}\n');await assert.rejects(decodeComponents(path,out),/BACKUP_COMPONENT_NAME_INVALID/);
 assert.deepEqual(await readdir(out),[]);
}));
test('v2 system archives authenticate their scope and remain rejected by the old DB-only reader',()=>fixture(async dir=>{
 const key=randomBytes(32),header=backupHeader(key,new Date(),'FULL_SYSTEM'),path=join(dir,archiveName(header.metadata));
 await encryptDump(Readable.from(['private-state']),path+'.part',path,key,{header});
 await assert.rejects(decryptDump(path,join(dir,'wrong-reader'),key),/BACKUP_HEADER_INVALID/);
 const result=await decryptDump(path,join(dir,'valid'),key,{expectedScope:'FULL_SYSTEM'});assert.equal(result.version,2);assert.equal(await readFile(join(dir,'valid'),'utf8'),'private-state');
 await assert.rejects(decryptDump(path,join(dir,'wrong-scope'),key,{expectedScope:'KEY_ESCROW'}),/BACKUP_HEADER_INVALID/);
}));
test('SQLite online backup includes WAL and preserves an unresolved allocation fence',()=>fixture(async dir=>{
 const source=join(dir,'live.sqlite'),destination=join(dir,'copy.sqlite'),journal=new RuntimeJournal(source),now=Date.now();
 try{
  journal.reserve({executionId:'pending',runtimeId:'runtime',projectId:'project',bindingHash:'binding',token:'a'.repeat(64),leaseUntil:now+45000,deadline:now+90000,allocationOwner:'unsettled-owner'});
  const before=journal.get('pending');const info=await snapshotSqlite(source,destination);assert.equal(info.active,1);assert.equal(info.fenced,1);
  const copy=new DatabaseSync(destination,{readOnly:true});try{assert.equal(copy.prepare('SELECT allocationOwner FROM runtimes').get().allocationOwner,'unsettled-owner');}finally{copy.close();}
  assert.deepEqual(journal.get('pending'),before);assert.equal(inspectSqlite(destination).kind,'runtime');
 }finally{journal.close();}
}));
test('revocation backup verifies independently authenticated WAL entries without resetting tombstones',()=>fixture(async dir=>{
 const source=join(dir,'revocations.sqlite'),copy=join(dir,'copy.sqlite'),key=randomBytes(32).toString('hex'),db=new DatabaseSync(source);
 try{
  await chmod(source,0o600);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE entries(id TEXT PRIMARY KEY,payload TEXT NOT NULL,mac TEXT NOT NULL)');
  const id='owner:deleted',payload=JSON.stringify({cutoff:Date.now(),deleted:true}),mac=createHmac('sha256',Buffer.from(key,'hex')).update(id+'\0'+payload).digest('hex');
  db.prepare('INSERT INTO entries VALUES(?,?,?)').run(id,payload,mac);
  assert.equal((await snapshotSqlite(source,copy)).rows,1);assert.equal(verifyRevocations(copy,key),1);assert.throws(()=>verifyRevocations(copy,randomBytes(32).toString('hex')),/BACKUP_REVOCATION_MAC_INVALID/);
  const damaged=new DatabaseSync(copy);damaged.prepare('UPDATE entries SET payload=?').run('{"deleted":false}');damaged.close();assert.throws(()=>verifyRevocations(copy,key),/BACKUP_REVOCATION_MAC_INVALID/);
  assert.equal(db.prepare('SELECT payload FROM entries').get().payload,payload);
 }finally{db.close();}
}));
test('pre-aborted SQLite capture never fabricates a successful snapshot',()=>fixture(async dir=>{
 const source=join(dir,'source.sqlite'),db=new DatabaseSync(source);db.exec('CREATE TABLE entries(id TEXT)');db.close();await chmod(source,0o600);
 const controller=new AbortController();controller.abort();await assert.rejects(snapshotSqlite(source,join(dir,'copy.sqlite'),controller.signal));
 assert.equal((await readdir(dir)).includes('copy.sqlite'),false);
}));
test('key escrow uses a distinct encryption key and restores only into a fresh private directory',()=>fixture(async dir=>{
 const archives=join(dir,'archives');await mkdir(archives,{mode:0o700});
 const vault={storage:{activeVersion:'v1',keys:{v1:randomBytes(32).toString('hex')}},transfer:{activeVersion:'v1',keys:{v1:randomBytes(32).toString('hex')}},revocationKey:randomBytes(32).toString('hex')};
 const env={ODDPATH_BACKUP_DIRECTORY:archives,ODDPATH_BACKUP_KEY_FILE:join(dir,'backup-key'),ODDPATH_FULL_ESCROW_KEY_FILE:join(dir,'escrow-key'),ODDPATH_FULL_VAULT_KEYRING_FILE:join(dir,'vault'),ODDPATH_RESTORE_ACK:'ISOLATED_EMPTY_TARGET'};
 for(const [path,value]of [[env.ODDPATH_BACKUP_KEY_FILE,randomBytes(32).toString('hex')],[env.ODDPATH_FULL_ESCROW_KEY_FILE,randomBytes(32).toString('hex')],[env.ODDPATH_FULL_VAULT_KEYRING_FILE,JSON.stringify(vault)]])await writeFile(path,value,{mode:0o600});
 const receipt=await createKeyEscrow(env);assert.equal(receipt.status,'KEY_ESCROW_VERIFIED');const path=join(archives,receipt.archive);
 assert.equal((await readFile(path)).includes(Buffer.from(vault.revocationKey)),false);
 await assert.rejects(decryptDump(path,join(dir,'wrong-key'),Buffer.from(await readFile(env.ODDPATH_BACKUP_KEY_FILE,'utf8'),'hex'),{expectedScope:'KEY_ESCROW'}),/BACKUP_KEY_MISMATCH/);
 const target=join(dir,'recovery');assert.equal((await restoreKeyEscrow(path,target,env)).releaseAuthorized,false);
 assert.deepEqual(JSON.parse(await readFile(join(target,'keys/vault-keyring.json'),'utf8')),vault);
 await assert.rejects(restoreKeyEscrow(path,target,env));
 await assert.rejects(createKeyEscrow({...env,ODDPATH_FULL_ESCROW_KEY_FILE:env.ODDPATH_BACKUP_KEY_FILE}),/BACKUP_INDEPENDENT_ESCROW_KEY_REQUIRED/);
}));
test('object export cannot silently choose arbitrary endpoints or downgrade production TLS',()=>{
 const env={NODE_ENV:'production',R2_ENDPOINT:'http://object-store:9000',R2_BUCKET_NAME:'synthetic',R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic'};
 assert.throws(()=>backupObjectSource(env),/BACKUP_OBJECT_ENDPOINT_INVALID/);assert.throws(()=>backupObjectSource({...env,R2_ENDPOINT:'https://attacker.test'}),/BACKUP_OBJECT_ENDPOINT_INVALID/);
 const source=backupObjectSource({...env,NODE_ENV:'test',ODDPATH_FULL_LOCAL_TESTS:'1'});source.close();
});
test('a DB-only receipt or previous health cannot satisfy the full-backup job',()=>{
 const old=jobManifest({ODDPATH_OPS_ROLE:'backup'}),full=jobManifest({ODDPATH_OPS_ROLE:'backup',ODDPATH_BACKUP_SCOPE:'FULL_SYSTEM'}),now=Date.now();
 const state={schemaVersion:1,status:'RUNNING',heartbeatAt:now,jobs:Object.fromEntries(old.map(j=>[j.id,{outcome:'PASS',failurePending:false,lastSuccessAt:now}]))};
 assert.equal(isHealthy(state,old,now),true);assert.equal(isHealthy(state,full,now),false);
 const job=full.find(j=>j.id==='backup-full');assert.equal(job.file,'ops/full-backup.mjs');
 assert.equal(successfulCompletion(job,{code:0,stdout:JSON.stringify({status:'ENCRYPTED_BACKUP_VERIFIED',scope:'CLOSED_DATABASE_ONLY'})}),false);
 assert.equal(successfulCompletion(job,{code:0,stdout:JSON.stringify({status:'ENCRYPTED_BACKUP_VERIFIED',scope:'FULL_SYSTEM'})}),true);
 assert.throws(()=>jobManifest({ODDPATH_OPS_ROLE:'backup',ODDPATH_BACKUP_SCOPE:'ignore-assets'}),/OPS_BACKUP_SCOPE_INVALID/);
});
test('paired full/key archives expire together at the exact seven-day boundary',()=>fixture(async dir=>{
 const key=randomBytes(32),now=Date.now(),day=86400000;
 for(const time of [now-7*day,now-7*day+1]){
  const names=[];for(const scope of ['FULL_SYSTEM','KEY_ESCROW']){
   const header=backupHeader(key,new Date(time),scope),path=join(dir,archiveName(header.metadata));names.push(path);
   await encryptDump(Readable.from(['synthetic']),path+'.part',path,key,{header});
  }
  assert.equal(dateFromArchiveName(names[0].split(/[\\/]/).at(-1)).getTime(),dateFromArchiveName(names[1].split(/[\\/]/).at(-1)).getTime());
 }
 assert.equal(await pruneBackups(dir,now),2);assert.equal((await readdir(dir)).filter(n=>n.endsWith('.opb')).length,2);
}));
test('exporter startup must not unlink an unexpected existing regular file',()=>fixture(async dir=>{
 const directory=join(dir,'socket');await mkdir(directory,{mode:0o700});const existing=join(directory,'sqlite.sock');await writeFile(existing,'retain-this-operator-file',{mode:0o600});
 await assert.rejects(runSqliteExporter({ODDPATH_SQLITE_SOCKET_DIRECTORY:directory,ODDPATH_SQLITE_EXPORT_KIND:'runtime',ODDPATH_SQLITE_SOURCE_FILE:join(dir,'unused')}),/BACKUP_SQLITE_SOCKET_UNSAFE/);
 assert.equal(await readFile(existing,'utf8'),'retain-this-operator-file');
}));
