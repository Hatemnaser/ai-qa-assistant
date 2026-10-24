import {createServer,request} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm,lstat,unlink,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {LocalOperationsLock} from './lib/local-lock.mjs';
import {privateDirectory,requireCondition} from './lib/private-files.mjs';
import {snapshotSqlite,checkSqliteFile} from './lib/backup-sqlite.mjs';

export async function runSqliteExporter(env=process.env,signal){
 const directory=await privateDirectory(env.ODDPATH_SQLITE_SOCKET_DIRECTORY),kind=env.ODDPATH_SQLITE_EXPORT_KIND;
 requireCondition(['runtime','revocations'].includes(kind),'BACKUP_SQLITE_EXPORT_KIND');
 const source=env.ODDPATH_SQLITE_SOURCE_FILE,socketPath=join(directory,'sqlite.sock');
 const lock=new LocalOperationsLock(join(directory,'exporter.lock.sqlite')),stop=new AbortController();let server,busy=false,active=Promise.resolve(),fatal,owned=false,listening=false;
 const abort=()=>stop.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 try{
  await lock.connect();owned=await lock.acquire();requireCondition(owned,'OPS_ALREADY_RUNNING');
  try{const old=await lstat(socketPath);requireCondition(old.isSocket()&&!old.isSymbolicLink(),'BACKUP_SQLITE_SOCKET_UNSAFE');await unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  server=createServer((req,res)=>{
   req.on('error',()=>{});res.on('error',()=>{});
   res.setHeader('Cache-Control','no-store');
   if(req.method==='GET'&&req.url==='/health'){
    // Readiness to export is distinct from a verified complete backup receipt.
    void checkSqliteFile(source).then(()=>res.end('ready'),()=>{res.statusCode=503;res.end();});return;
   }
   if(req.method!=='POST'||req.url!=='/snapshot'||busy||stop.signal.aborted){res.statusCode=503;res.end();return;}
   busy=true;
   active=(async()=>{
    let temp;
    try{
     await lock.check();temp=await privateDirectory(await mkdtemp(join(tmpdir(),'oddpath-export-')));const destination=join(temp,'snapshot.sqlite');
     const summary=await snapshotSqlite(source,destination,stop.signal);requireCondition(summary.kind===kind,'BACKUP_SQLITE_SCHEMA_INVALID');
     const hash=createHash('sha256');for await(const chunk of createReadStream(destination))hash.update(chunk);
     await lock.check();const info=await lstat(destination);
     res.setHeader('Content-Type','application/vnd.sqlite3');res.setHeader('Content-Length',info.size);res.setHeader('X-Oddpath-Sqlite-Kind',kind);
     res.setHeader('X-Oddpath-Sha256',hash.digest('hex'));res.setHeader('X-Oddpath-Captured-At',new Date().toISOString());
     await pipeline(createReadStream(destination),res,{signal:stop.signal});
    }catch{
     if(!res.headersSent){res.statusCode=503;res.end();}else res.destroy();
    }finally{
     if(temp){requireCondition(resolve(temp).startsWith(resolve(tmpdir())+sep)&&temp.startsWith(join(tmpdir(),'oddpath-export-')),'BACKUP_TEMP_PATH_INVALID');await rm(temp,{recursive:true,force:true});}
     busy=false;
    }
   })();active.catch(error=>{fatal=error;res.destroy();stop.abort();});
  });
  server.on('clientError',(_error,socket)=>socket.destroy());
  await new Promise((yes,no)=>{server.once('error',no);server.listen(socketPath,yes);});
  listening=true;
  await chmod(socketPath,kind==='revocations'?0o660:0o600);
  await new Promise(yes=>{if(stop.signal.aborted)yes();else stop.signal.addEventListener('abort',yes,{once:true});});
 }finally{
  try{
   if(listening){server.closeAllConnections();await new Promise(yes=>server.close(yes));}
   await active.catch(()=>{});
   if(owned&&listening)try{const info=await lstat(socketPath);requireCondition(info.isSocket()&&!info.isSymbolicLink(),'BACKUP_SQLITE_SOCKET_UNSAFE');await unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  }finally{await lock.end();signal?.removeEventListener('abort',abort);}
 }
 if(fatal)throw fatal;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 try{
  if(process.argv[2]==='health'){
   await new Promise((yes,no)=>{const req=request({socketPath:join(process.env.ODDPATH_SQLITE_SOCKET_DIRECTORY,'sqlite.sock'),path:'/health',timeout:2000},res=>{res.resume();res.on('end',()=>res.statusCode===200?yes():no(Error('unavailable')));});req.once('error',no);req.once('timeout',()=>req.destroy(Error('timeout')));req.end();});
  }else {requireCondition(process.argv.length===2,'BACKUP_SQLITE_EXPORT_USAGE');await runSqliteExporter(process.env,controller.signal);}
 }catch{console.error(JSON.stringify({status:'FAILED',code:'BACKUP_SQLITE_EXPORT_UNAVAILABLE'}));process.exitCode=1;}
}
