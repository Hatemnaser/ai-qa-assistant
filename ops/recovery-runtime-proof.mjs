import {request} from 'node:http';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {lstat,realpath,readFile,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {checkSqliteFile} from './lib/backup-sqlite.mjs';
import {requireCondition} from './lib/private-files.mjs';

async function docker(path,signal){
 return new Promise((yes,no)=>{
  const req=request({socketPath:'/var/run/docker.sock',path,method:'GET',signal,timeout:5000},res=>{
   let text='';res.setEncoding('utf8');res.on('data',b=>{text+=b;if(text.length>4*1024*1024)req.destroy(new Error('RECOVERY_DOCKER_RESPONSE_LIMIT'));});
   res.once('error',no);res.once('end',()=>{try{requireCondition(res.statusCode===200,'RECOVERY_DOCKER_UNAVAILABLE');yes(JSON.parse(text));}catch(e){no(e);}});
  });req.once('error',no);req.once('timeout',()=>req.destroy(new Error('RECOVERY_DOCKER_TIMEOUT')));req.end();
 });
}

/** Live local engine and native journal, never an operator-authored proof receipt. */
export async function proveRecoveryRuntime({env=process.env,query,signal,get=docker}={}){
 const pg=env.ODDPATH_RECOVERY_POSTGRES_CONTAINER,supervisor=env.ODDPATH_RECOVERY_SUPERVISOR_CONTAINER;
 requireCondition([pg,supervisor].every(v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(v))&&pg!==supervisor,'RECOVERY_DEPLOYMENT_IDENTITIES_REQUIRED');
 const self=await get('/containers/'+hostname()+'/json',signal),database=await get('/containers/'+pg+'/json',signal),worker=await get('/containers/'+supervisor+'/json',signal);
 requireCondition(self.Id?.startsWith(hostname())&&self.State?.Running===true&&database.Id!==self.Id&&worker.Id!==self.Id,'RECOVERY_OPERATOR_IDENTITY_INVALID');
 const stopped=c=>c.State?.Running===false&&c.State?.Restarting===false&&c.State?.Paused===false&&c.State?.Pid===0;
 requireCondition(database.State?.Running===true&&stopped(worker),'RECOVERY_SUPERVISOR_NOT_DRAINED');
 const running=await get('/containers/json?all=true',signal);
 requireCondition(Array.isArray(running)&&running.every(c=>['exited','created','dead'].includes(c.State)||[self.Id,database.Id].includes(c.Id)),'RECOVERY_DEPLOYMENT_NOT_DRAINED');
 requireCondition(!running.some(c=>c.Labels?.['oddpath.runtime']==='1'),'RECOVERY_RUNTIME_RESOURCES_REMAIN');
 const networks=await get('/networks',signal);requireCondition(Array.isArray(networks)&&!networks.some(n=>n.Labels?.['oddpath.runtime']==='1'),'RECOVERY_RUNTIME_RESOURCES_REMAIN');
 const addr=(await query('SELECT host(inet_server_addr()) AS address')).rows[0]?.address;
 requireCondition(typeof addr==='string'&&Object.values(database.NetworkSettings?.Networks??{}).some(n=>n.IPAddress===addr||n.GlobalIPv6Address===addr),'RECOVERY_POSTGRES_HOST_MISMATCH');
 const producer=worker.Mounts?.find(m=>m.Destination==='/var/lib/oddpath'),consumer=self.Mounts?.find(m=>m.Destination==='/recovery-runtime');
 requireCondition(producer?.Type==='volume'&&consumer?.Type==='volume'&&producer.Name===consumer.Name&&producer.Source===consumer.Source&&consumer.RW===false,'RECOVERY_CURRENT_JOURNAL_MOUNT_REQUIRED');
 const file='/recovery-runtime/runtime.sqlite',identity=await checkSqliteFile(file);
 const checkpointed=async()=>{try{const wal=await lstat(file+'-wal');requireCondition(wal.isFile()&&!wal.isSymbolicLink()&&wal.size===0,'RECOVERY_JOURNAL_CHECKPOINT_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}};
 await checkpointed();requireCondition(identity.size>0&&identity.size<=64*1024*1024,'RECOVERY_RUNTIME_JOURNAL_LIMIT');
 // All producers are stopped. Require a checkpointed source, then inspect a
 // private copy: readonly WAL opens must not need to create SHM on its RO mount.
 // A nonempty WAL is refused, never silently omitted or checkpointed by us.
 const bytes=await readFile(file),directory=await mkdtemp(join(tmpdir(),'oddpath-recovery-proof-')),copy=join(directory,'runtime.sqlite');
 let db,hash,rows;
 try{
  await writeFile(copy,bytes,{flag:'wx',mode:0o600});db=new DatabaseSync(copy,{readOnly:true});
  db.exec('BEGIN');requireCondition(db.prepare('PRAGMA quick_check').get().quick_check==='ok','RECOVERY_RUNTIME_JOURNAL_INVALID');
  rows=db.prepare('SELECT execution,runtime,state,allocationOwner,stopped,proof,reported FROM runtimes ORDER BY execution LIMIT 100001').all();
  requireCondition(rows.length<=100000&&db.prepare('SELECT count(*) n FROM failure_reports').get().n===0,'RECOVERY_RUNTIME_REPORTS_PENDING');
  requireCondition(rows.every(row=>{let proof;try{proof=JSON.parse(row.proof);}catch{return false;}return row.state==='STOPPED'&&row.allocationOwner===null&&row.reported===1&&Number.isSafeInteger(row.stopped)&&row.stopped>0&&proof?.processExited===true&&Number.isSafeInteger(proof.observedAt)&&proof.observedAt>=row.stopped;}),'RECOVERY_RUNTIME_STOP_UNCONFIRMED');
  hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');db.exec('COMMIT');
 }finally{db?.close();for(const p of [copy,copy+'-wal',copy+'-shm'])await unlink(p).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
 await checkpointed();const after=await lstat(file);requireCondition(after.dev===identity.dev&&after.ino===identity.ino&&await realpath(file)===file&&bytes.equals(await readFile(file)),'RECOVERY_RUNTIME_JOURNAL_CHANGED');
 // Reobserve service drain after the asynchronous SQLite/filesystem work.
 const last=await get('/containers/json?all=true',signal);
 requireCondition(Array.isArray(last)&&last.every(c=>['exited','created','dead'].includes(c.State)||[self.Id,database.Id].includes(c.Id))&&!last.some(c=>c.Labels?.['oddpath.runtime']==='1'),'RECOVERY_DEPLOYMENT_NOT_DRAINED');
 return {engine:database.Id,supervisor:worker.Id,journalVolume:producer.Name,journalSha256:hash,settledRuntimes:rows.length,observedAt:new Date().toISOString()};
}
