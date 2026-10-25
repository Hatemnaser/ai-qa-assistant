import {request} from 'node:http';
import {createWriteStream} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {isAbsolute} from 'node:path';
import {requireCondition} from './private-files.mjs';
import {inspectSqlite} from './backup-sqlite.mjs';

/** Private UDS only. The producer's native UID owns SQLite's WAL bookkeeping. */
export async function receiveSqlite(socketPath,destination,kind,signal){
 requireCondition(typeof socketPath==='string'&&isAbsolute(socketPath)&&['runtime','revocations'].includes(kind),'BACKUP_SQLITE_SOCKET_INVALID');
 const started=Date.now(),hash=createHash('sha256');let bytes=0;
 const response=await new Promise((yes,no)=>{
  const req=request({socketPath,path:'/snapshot',method:'POST',signal,timeout:120000},yes);req.once('error',no);req.once('timeout',()=>req.destroy(new Error('BACKUP_SQLITE_EXPORT_TIMEOUT')));req.end();
 });
 try{
  requireCondition(response.statusCode===200&&response.headers['x-oddpath-sqlite-kind']===kind,'BACKUP_SQLITE_EXPORT_UNAVAILABLE');
  const expectedSize=Number(response.headers['content-length']),expectedHash=response.headers['x-oddpath-sha256'],capturedAt=response.headers['x-oddpath-captured-at'];
  requireCondition(Number.isSafeInteger(expectedSize)&&expectedSize>0&&expectedSize<=5*1024**3&&typeof expectedHash==='string'&&/^[a-f0-9]{64}$/.test(expectedHash),'BACKUP_SQLITE_EXPORT_INVALID');
  requireCondition(typeof capturedAt==='string'&&Date.parse(capturedAt)>=started-1000&&Date.parse(capturedAt)<=Date.now()+1000,'BACKUP_SQLITE_EXPORT_STALE');
  const bounded=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(bytes>expectedSize?new Error('BACKUP_SQLITE_EXPORT_SIZE'):null,chunk);}});
  await pipeline(response,bounded,createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
  requireCondition(bytes===expectedSize&&hash.digest('hex')===expectedHash,'BACKUP_SQLITE_EXPORT_HASH');
  const file=await open(destination,'r+');try{await file.sync();}finally{await file.close();}
  const summary=inspectSqlite(destination);requireCondition(summary.kind===kind,'BACKUP_SQLITE_SCHEMA_INVALID');return {...summary,capturedAt};
 }finally{response.destroy();}
}
