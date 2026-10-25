import {DatabaseSync,backup} from 'node:sqlite';
import {lstat,realpath,chmod} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {requireCondition} from './private-files.mjs';

export async function checkSqliteFile(path){
 requireCondition(typeof path==='string'&&isAbsolute(path)&&await realpath(path)===resolve(path),'BACKUP_SQLITE_PATH_INVALID');
 const info=await lstat(path);requireCondition(info.isFile()&&!info.isSymbolicLink()&&(process.platform==='win32'||(info.mode&0o077)===0),'BACKUP_SQLITE_PERMISSIONS');
 return info;
}
export async function snapshotSqlite(source,destination,signal){
 const identity=await checkSqliteFile(source),db=new DatabaseSync(source,{readOnly:true});
 try{
  signal?.throwIfAborted();
  // SQLite's online backup includes WAL commits; never copy only the main file.
  // The native operation has no AbortSignal. Await settlement before deleting
  // its output; a killed worker's enclosing private tmpfs is discarded.
  await backup(db,destination);signal?.throwIfAborted();await chmod(destination,0o600);
  // A published export must be self-contained: consumers need neither the
  // source's WAL/SHM nor write access to create their own shared-memory files.
  const standalone=new DatabaseSync(destination);
  try{requireCondition(standalone.prepare('PRAGMA journal_mode=DELETE').get().journal_mode==='delete','BACKUP_SQLITE_EXPORT_MODE');}finally{standalone.close();}
  const after=await checkSqliteFile(source);requireCondition(identity.dev===after.dev&&identity.ino===after.ino,'BACKUP_SQLITE_REPLACED');
 }finally{db.close();}
 return inspectSqlite(destination);
}
export function inspectSqlite(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{requireCondition(db.prepare('PRAGMA quick_check').get().quick_check==='ok','BACKUP_SQLITE_INTEGRITY');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
  if(tables.includes('runtimes'))return {kind:'runtime',rows:Number(db.prepare('SELECT count(*) n FROM runtimes').get().n),active:Number(db.prepare("SELECT count(*) n FROM runtimes WHERE state<>'STOPPED'").get().n),fenced:Number(db.prepare('SELECT count(*) n FROM runtimes WHERE allocationOwner IS NOT NULL').get().n)};
  requireCondition(tables.includes('entries'),'BACKUP_SQLITE_SCHEMA_INVALID');return {kind:'revocations',rows:Number(db.prepare('SELECT count(*) n FROM entries').get().n)};
 }finally{db.close();}
}
export function verifyRevocations(path,key){
 requireCondition(/^[a-f0-9]{64}$/.test(key),'BACKUP_VAULT_KEY_INVALID');const db=new DatabaseSync(path,{readOnly:true});let count=0;
 try{for(const row of db.prepare('SELECT id,payload,mac FROM entries').iterate()){
  const expected=createHmac('sha256',Buffer.from(key,'hex')).update(row.id+'\0'+row.payload).digest(),actual=Buffer.from(row.mac,'hex');
  requireCondition(actual.length===expected.length&&timingSafeEqual(actual,expected),'BACKUP_REVOCATION_MAC_INVALID');
  try{JSON.parse(row.payload);}catch{throw new Error('BACKUP_REVOCATION_PAYLOAD_INVALID');}count++;
 }return count;}finally{db.close();}
}
