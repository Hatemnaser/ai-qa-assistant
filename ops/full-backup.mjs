import {createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {readFile,mkdtemp,rm,mkdir,copyFile,open,realpath,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,basename,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {validateBrowserStateKeys} from '@oddpath/qa-execution-contract/browser-state-crypto';
import {backupHeader,archiveName,encryptDump,decryptDump} from './lib/backup-archive.mjs';
import {encodeComponents,decodeComponents} from './lib/backup-components.mjs';
import {snapshotSqlite,inspectSqlite,verifyRevocations} from './lib/backup-sqlite.mjs';
import {receiveSqlite} from './lib/sqlite-export-client.mjs';
import {backupObjectSource} from './lib/backup-objects.mjs';
import {privateDirectory,readPrivate,requireCondition,atomicJson,syncDirectory} from './lib/private-files.mjs';
import {settings,pgClient,tool,restoreTargetAllowed,requireIsolatedRestoreTarget,markRestoreQuarantined,pruneBackups} from './backup.mjs';
import {RECOVERY_DATABASE_QUERY,assertOperationalDatabase} from '@oddpath/qa-execution-contract';

const repo=resolve(import.meta.dirname,'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonStream=value=>Readable.from([JSON.stringify(value)]);
const safeError=e=>[e?.code,e?.message].find(v=>typeof v==='string'&&/^(?:BACKUP|RESTORE|OPS)_[A-Z_]+$/.test(v))??'BACKUP_FULL_OPERATION_FAILED';
async function archiveSettings(env,keyFile=env.ODDPATH_BACKUP_KEY_FILE){
 const directory=await privateDirectory(env.ODDPATH_BACKUP_DIRECTORY),inside=relative(repo,directory);
 requireCondition(inside.startsWith('..')||isAbsolute(inside),'BACKUP_OUTSIDE_CHECKOUT_REQUIRED');
 const encoded=(await readPrivate(keyFile,128)).toString().trim();requireCondition(/^[a-f0-9]{64}$/.test(encoded),'BACKUP_KEY_INVALID');
 return {directory,key:Buffer.from(encoded,'hex')};
}
async function vaultSettings(env){
 const bytes=await readPrivate(env.ODDPATH_FULL_VAULT_KEYRING_FILE,32768);let value;
 try{value=JSON.parse(bytes);}catch{throw new Error('BACKUP_VAULT_KEY_INVALID');}
 const storage=validateBrowserStateKeys(value.storage),transfer=validateBrowserStateKeys(value.transfer);
 const all=[...Object.values(storage.keys),...Object.values(transfer.keys),value.revocationKey];
 requireCondition(all.every(k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k))&&
  !Object.values(storage.keys).some(k=>Object.values(transfer.keys).includes(k)||k===value.revocationKey)&&
  !Object.values(transfer.keys).includes(value.revocationKey),'BACKUP_VAULT_KEY_INVALID');
 return {bytes,value,fingerprint:digest(bytes)};
}
async function tempDirectory(){return privateDirectory(await mkdtemp(join(tmpdir(),'oddpath-full-')));}
async function removeTemp(path){requireCondition(resolve(path).startsWith(resolve(tmpdir())+sep)&&basename(path).startsWith('oddpath-full-'),'BACKUP_TEMP_PATH_INVALID');await rm(path,{recursive:true,force:true});}
async function fileHash(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function writeArchive(entries,config,scope,signal,onComplete,clock=new Date()){
 const header=backupHeader(config.key,clock,scope),destination=join(config.directory,archiveName(header.metadata)),part=destination+'.part';
 try{await encryptDump(encodeComponents(entries,onComplete),part,destination,config.key,{header,signal});return {header,destination,sha256:await fileHash(destination)};}
 catch(error){await unlink(part).catch(()=>{});throw error;}
}
async function openArchive(path,env,scope,signal,keyFile){
 const config=await archiveSettings(env,keyFile);requireCondition(await realpath(path)===resolve(path),'BACKUP_SYMLINK_ARCHIVE');
 const directory=await tempDirectory();
 try{
  const packed=join(directory,'components.bin'),metadata=await decryptDump(path,packed,config.key,{signal,expectedScope:scope});
  const entries=await decodeComponents(packed,directory,{signal});await unlink(packed);
  return {directory,metadata,entries,config};
 }catch(error){await removeTemp(directory);throw error;}
}

export async function createKeyEscrow(env=process.env,signal,clock=new Date()){
 const archive=await archiveSettings(env),config=await archiveSettings(env,env.ODDPATH_FULL_ESCROW_KEY_FILE),vault=await vaultSettings(env);
 requireCondition(!config.key.equals(archive.key),'BACKUP_INDEPENDENT_ESCROW_KEY_REQUIRED');
 const keys=[...Object.values(vault.value.storage.keys),...Object.values(vault.value.transfer.keys),vault.value.revocationKey];
 requireCondition(!keys.includes(config.key.toString('hex'))&&!keys.includes(archive.key.toString('hex')),'BACKUP_INDEPENDENT_ESCROW_KEY_REQUIRED');
 const components=[{name:'keys/vault-keyring.json',stream:Readable.from([vault.bytes])}];
 if(env.ODDPATH_FULL_OPERATOR_ESCROW_FILE)components.push({name:'keys/operator-config.json',stream:Readable.from([await readPrivate(env.ODDPATH_FULL_OPERATOR_ESCROW_FILE,32768)])});
 const written=await writeArchive(components,config,'KEY_ESCROW',signal,undefined,clock);
 try{
  const verified=await openArchive(written.destination,env,'KEY_ESCROW',signal,env.ODDPATH_FULL_ESCROW_KEY_FILE);
  try{requireCondition(verified.entries.some(e=>e.name==='keys/vault-keyring.json'&&e.sha256===vault.fingerprint),'BACKUP_ESCROW_VERIFY_FAILED');}
  finally{await removeTemp(verified.directory);}
  return {status:'KEY_ESCROW_VERIFIED',createdAt:written.header.metadata.createdAt,archive:basename(written.destination),sha256:written.sha256,vaultFingerprint:vault.fingerprint,operatorConfigurationIncluded:!!env.ODDPATH_FULL_OPERATOR_ESCROW_FILE};
 }catch(error){await unlink(written.destination).catch(()=>{});throw error;}
}

export async function verifyFullBackup(path,env=process.env,signal){
 const verified=await openArchive(path,env,'FULL_SYSTEM',signal);
 try{
  const manifest=JSON.parse(await readFile(join(verified.directory,'manifest.json'),'utf8'));
  requireCondition(manifest.schemaVersion===1&&manifest.scope==='FULL_SYSTEM'&&manifest.captureMode==='INDEPENDENT_SNAPSHOTS_QUARANTINED'&&Array.isArray(manifest.components)&&Array.isArray(manifest.objects),'BACKUP_FULL_MANIFEST_INVALID');
  const actual=verified.entries.filter(e=>e.name!=='manifest.json');
  requireCondition(JSON.stringify(actual)===JSON.stringify(manifest.components),'BACKUP_FULL_COMPONENT_MISMATCH');
  for(const name of ['postgres.dump','runtime.sqlite','revocations.sqlite'])requireCondition(actual.some(e=>e.name===name),'BACKUP_FULL_COMPONENT_MISSING');
  const objects=actual.filter(e=>e.name.startsWith('objects/'));
  requireCondition(objects.length===manifest.objects.length&&manifest.objects.every((o,i)=>o.name===objects[i].name&&o.bytes===objects[i].bytes&&o.sha256===objects[i].sha256),'BACKUP_FULL_OBJECT_MISMATCH');
  requireCondition(inspectSqlite(join(verified.directory,'runtime.sqlite')).kind==='runtime'&&inspectSqlite(join(verified.directory,'revocations.sqlite')).kind==='revocations','BACKUP_SQLITE_SCHEMA_INVALID');
  // Inspect a real PostgreSQL archive before any restored database is opened.
  // No application or provider module is imported by this verification.
  const pgEnv=Object.fromEntries(Object.entries(env).filter(([k])=>['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'].includes(k)));
  await tool('pg_restore',['--list',join(verified.directory,'postgres.dump')],pgEnv,signal);
  return {...verified,manifest};
 }catch(error){await removeTemp(verified.directory);throw error;}
}

export async function createFullBackup(env=process.env,signal){
 const config=await settings(env),vault=await vaultSettings(env),directory=await tempDirectory(),controller=new AbortController(),startedAt=new Date().toISOString();
 const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 let client,child,done,objects,escrow,written,timer,snapshotClosed=false;
 try{
  // Paired data/key archives have exactly the same retention timestamp. An
  // escrow must never expire while its associated data archive is still kept.
  controller.signal.throwIfAborted();escrow=await createKeyEscrow(env,controller.signal,new Date(startedAt));
  requireCondition(escrow.vaultFingerprint===vault.fingerprint,'BACKUP_VAULT_KEY_CHANGED');
  client=await pgClient();client.on('error',abort);client.on('end',abort);timer=setTimeout(abort,30*60_000);
  assertOperationalDatabase((await client.query(RECOVERY_DATABASE_QUERY)).rows);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await client.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
  requireCondition(/^[A-F0-9-]+$/i.test(snapshot),'BACKUP_SNAPSHOT_INVALID');
  const records=(await client.query('SELECT id,"objectKey",status,"sizeBytes","expectedSizeBytes","checksumSha256" FROM "StoredAsset" ORDER BY id LIMIT 10001')).rows;
  requireCondition(records.length<=10000,'BACKUP_FULL_OBJECT_LIMIT');
  requireCondition(records.every(r=>typeof r.id==='string'&&r.id.length<=200&&typeof r.objectKey==='string'&&Buffer.byteLength(r.objectKey)<=1024&&!/[\x00-\x1f\x7f]/.test(r.objectKey)),'BACKUP_OBJECT_IDENTITY_INVALID');
  const accounting=(await client.query(`SELECT
   (SELECT count(*)::int FROM "UsageEvent") AS events,
   (SELECT count(*)::int FROM "UsageSettlementReceipt") AS receipts,
   (SELECT count(*)::int FROM "UsageEvent" WHERE status IN ('unknown','reserved')) AS unresolved,
   (SELECT count(*)::int FROM "QaBrowserReservation" WHERE state<>'RELEASED') AS browser_holds`)).rows[0];
  const runtime=await receiveSqlite(env.ODDPATH_FULL_RUNTIME_SOCKET,join(directory,'runtime.sqlite'),'runtime',controller.signal);
  const revocations=await receiveSqlite(env.ODDPATH_FULL_REVOCATIONS_SOCKET,join(directory,'revocations.sqlite'),'revocations',controller.signal);
  requireCondition(runtime.kind==='runtime'&&revocations.kind==='revocations','BACKUP_SQLITE_SCHEMA_INVALID');
  verifyRevocations(join(directory,'revocations.sqlite'),vault.value.revocationKey);
  const manifest={schemaVersion:1,scope:'FULL_SYSTEM',captureMode:'INDEPENDENT_SNAPSHOTS_QUARANTINED',startedAt,components:[],objects:[],notYetDurableAssets:[],accounting,runtime,revocations,vaultFingerprint:vault.fingerprint,escrow};
  if(records.some(r=>r.status==='READY'))objects=backupObjectSource(env);
  child=spawn('pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot='+snapshot],{env:config.pgEnv,stdio:['ignore','pipe','ignore'],windowsHide:true});
  done=new Promise((yes,no)=>{child.once('error',no);child.once('close',code=>code===0?yes():no(new Error('BACKUP_DUMP_FAILED')));});done.catch(()=>{});
  const kill=()=>child.kill('SIGKILL');controller.signal.addEventListener('abort',kill,{once:true});
  try{
   const entries=(async function*(){
    yield {name:'postgres.dump',stream:child.stdout};await done;
    // The relational snapshot is finished. Do not retain an MVCC transaction
    // while potentially slow external object transfers run.
    await client.query('COMMIT');snapshotClosed=true;
    yield {name:'runtime.sqlite',stream:createReadStream(join(directory,'runtime.sqlite'))};
    yield {name:'revocations.sqlite',stream:createReadStream(join(directory,'revocations.sqlite'))};
    for(const record of records){
     controller.signal.throwIfAborted();
     if(record.status!=='READY'){manifest.notYetDurableAssets.push({id:record.id,status:record.status});continue;}
     const name='objects/'+String(manifest.objects.length).padStart(8,'0')+'.bin',object=await objects.read(record.objectKey,controller.signal);
     requireCondition(object.size===record.sizeBytes&&object.size===record.expectedSizeBytes,'BACKUP_OBJECT_SIZE_MISMATCH');
     manifest.objects.push({name,id:record.id,objectKey:record.objectKey,expected:record.checksumSha256});yield {name,stream:object.stream};
    }
    manifest.finishedAt=new Date().toISOString();yield {name:'manifest.json',stream:jsonStream(manifest)};
   })();
   written=await writeArchive(entries,config,'FULL_SYSTEM',controller.signal,entry=>{
    if(entry.name==='manifest.json')return;manifest.components.push(entry);
    if(entry.name.startsWith('objects/')){
     const object=manifest.objects.at(-1);requireCondition(Buffer.from(entry.sha256,'hex').toString('base64')===object.expected,'BACKUP_OBJECT_CHECKSUM_MISMATCH');
     delete object.expected;Object.assign(object,{bytes:entry.bytes,sha256:entry.sha256});
    }
   },new Date(startedAt));
  }finally{controller.signal.removeEventListener('abort',kill);if(!written){kill();await done.catch(()=>{});}}
  if(!snapshotClosed)await client.query('COMMIT');
  requireCondition((await vaultSettings(env)).fingerprint===vault.fingerprint,'BACKUP_VAULT_KEY_CHANGED');
  const verified=await verifyFullBackup(written.destination,env,controller.signal);await removeTemp(verified.directory);
  const receipt={schemaVersion:1,status:'ENCRYPTED_BACKUP_VERIFIED',scope:'FULL_SYSTEM',archive:basename(written.destination),sha256:written.sha256,createdAt:written.header.metadata.createdAt,
   escrowArchive:escrow.archive,escrowSha256:escrow.sha256,objects:manifest.objects.length,notYetDurableAssets:manifest.notYetDurableAssets.length,
   activeRuntimeRows:runtime.active,creatorFences:runtime.fenced,financialContinuity:'SNAPSHOT_ONLY',offHostCopyVerified:false,recoveryAuthorization:false};
  await pruneBackups(config.directory);await atomicJson(join(config.directory,'backup-status.json'),receipt);return receipt;
 }catch(error){await client?.query('ROLLBACK').catch(()=>{});if(written)await unlink(written.destination).catch(()=>{});throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);objects?.close();await client?.end().catch(()=>{});await removeTemp(directory);}
}

async function newRecoveryDirectory(path){
 requireCondition(typeof path==='string'&&isAbsolute(path),'RESTORE_PRIVATE_DIRECTORY_REQUIRED');
 const inside=relative(repo,resolve(path));requireCondition(inside.startsWith('..')||isAbsolute(inside),'BACKUP_OUTSIDE_CHECKOUT_REQUIRED');
 await privateDirectory(dirname(path));await mkdir(path,{mode:0o700});return privateDirectory(path);
}
async function copyComponents(verified,directory){
 for(const entry of verified.entries){const destination=join(directory,entry.name);await mkdir(dirname(destination),{mode:0o700,recursive:true});
  await copyFile(join(verified.directory,entry.name),destination,constants.COPYFILE_EXCL);const file=await open(destination,'r+');try{await file.sync();}finally{await file.close();}
 }
 await syncDirectory(directory);
}
export async function restoreKeyEscrow(path,destination,env=process.env,signal){
 requireCondition(env.ODDPATH_RESTORE_ACK==='ISOLATED_EMPTY_TARGET','RESTORE_ISOLATED_TARGET_REQUIRED');
 const verified=await openArchive(path,env,'KEY_ESCROW',signal,env.ODDPATH_FULL_ESCROW_KEY_FILE);
 try{
  requireCondition(verified.entries.some(e=>e.name==='keys/vault-keyring.json')&&verified.entries.every(e=>e.name.startsWith('keys/')),'BACKUP_ESCROW_VERIFY_FAILED');
  await vaultSettings({...env,ODDPATH_FULL_VAULT_KEYRING_FILE:join(verified.directory,'keys/vault-keyring.json')});
  const directory=await newRecoveryDirectory(destination);await copyComponents(verified,directory);
  const result={schemaVersion:1,status:'KEYS_RESTORED_QUARANTINED',releaseAuthorized:false,backupId:verified.metadata.id};await atomicJson(join(directory,'recovery-state.json'),result);return result;
 }finally{await removeTemp(verified.directory);}
}
export async function restoreFullBackup(path,confirmation,env=process.env,signal){
 requireCondition(restoreTargetAllowed(env.PGDATABASE,confirmation,env.ODDPATH_RESTORE_ACK),'RESTORE_ISOLATED_TARGET_REQUIRED');
 const config=await settings(env),verified=await verifyFullBackup(path,env,signal);let client,directory;
 try{
  const vault=await vaultSettings(env);requireCondition(vault.fingerprint===verified.manifest.vaultFingerprint,'BACKUP_VAULT_KEY_MISMATCH');
  verifyRevocations(join(verified.directory,'revocations.sqlite'),vault.value.revocationKey);
  directory=await newRecoveryDirectory(env.ODDPATH_FULL_RESTORE_DIRECTORY);await copyComponents(verified,join(await privateDirectory(join(directory,'historical'))));
  let authority='HISTORICAL_ONLY_NOT_AUTHORITY';
  if(env.ODDPATH_CURRENT_REVOCATIONS_SOCKET||env.ODDPATH_CURRENT_REVOCATIONS_FILE){
   const current=await privateDirectory(join(directory,'current'));
   if(env.ODDPATH_CURRENT_REVOCATIONS_SOCKET)await receiveSqlite(env.ODDPATH_CURRENT_REVOCATIONS_SOCKET,join(current,'revocations.sqlite'),'revocations',signal);
   else await snapshotSqlite(env.ODDPATH_CURRENT_REVOCATIONS_FILE,join(current,'revocations.sqlite'),signal);
   verifyRevocations(join(current,'revocations.sqlite'),vault.value.revocationKey);authority='INDEPENDENT_JOURNAL_STAGED_FRESHNESS_UNVERIFIED';
  }
  const receipt={schemaVersion:1,status:'STAGED_NOT_RESTORED',scope:'FULL_SYSTEM',backupId:verified.metadata.id,releaseAuthorized:false,
   financialContinuity:'UNVERIFIED',deletionContinuity:'UNVERIFIED',savedLoginAuthority:authority,runtimeAuthority:'HISTORICAL_NEVER_RESUME_OR_CLEAR_FENCES',objectRestore:'PRIVATE_FILES_ONLY_NOT_LIVE_BUCKET',
   requirements:['Current independent consumption and deletion evidence; no guessed debit or provider replay','Fresh physical Stop/settlement proof; never reset creator fences',
    'Current authenticated revocation continuity or invalidate old storage generations and require fresh consent','Reconcile deleted identities and object-deletion outbox before any live import',
    'Reviewed migration/grants, isolated object reimport, current-build smoke and independent recovery/release approval']};
  await atomicJson(join(directory,'recovery-state.json'),receipt);
  client=await pgClient();await requireIsolatedRestoreTarget(client,confirmation);
  await markRestoreQuarantined(client,confirmation);
  await tool('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname='+confirmation,join(verified.directory,'postgres.dump')],config.pgEnv,signal);
  receipt.status='RESTORED_QUARANTINED';receipt.restoredAt=new Date().toISOString();await atomicJson(join(directory,'recovery-state.json'),receipt);return receipt;
 }catch(error){
  if(directory)await atomicJson(join(directory,'restore-failure.json'),{status:'RESTORE_UNCONFIRMED_QUARANTINED',code:safeError(error),releaseAuthorized:false}).catch(()=>{});
  throw error;
 }finally{await client?.end().catch(()=>{});await removeTemp(verified.directory);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 try{
  const [command,...args]=process.argv.slice(2);let result;
  if(command==='create'&&!args.length)result=await createFullBackup(process.env,controller.signal);
  else if(command==='verify'&&args.length===1){const v=await verifyFullBackup(resolve(args[0]),process.env,controller.signal);try{result={status:'FULL_ARCHIVE_AUTHENTICATED',backupId:v.metadata.id,objects:v.manifest.objects.length,recoveryAuthorization:false};}finally{await removeTemp(v.directory);}}
  else if(command==='restore'&&args.length===3&&args[1]==='--confirm-target')result=await restoreFullBackup(resolve(args[0]),args[2],process.env,controller.signal);
  else if(command==='restore-keys'&&args.length===3&&args[1]==='--confirm-directory')result=await restoreKeyEscrow(resolve(args[0]),resolve(args[2]),process.env,controller.signal);
  else throw new Error('BACKUP_FULL_USAGE_CREATE_VERIFY_RESTORE_KEYS');
  console.log(JSON.stringify(result));
 }catch(error){console.error(JSON.stringify({status:'FAILED',code:safeError(error)}));process.exitCode=1;}
}
